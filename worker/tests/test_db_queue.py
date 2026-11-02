"""Cola: reserva atómica, renovación, caducidad, fencing, cancelación, reintentos, revocación y permisos."""
import threading
import time

import psycopg
import pytest

from inmo_worker.db import LeaseLost, WorkerAPI
from inmo_worker.queue import JobCancelled, Outcome, RetryableError, Runner, SourceBlocked

from .conftest import WORKER, as_user, OWNER, OTHER

pytestmark = pytest.mark.db


def api():
    return WorkerAPI(WORKER)


def test_worker_role_has_no_table_access(db):
    with psycopg.connect(WORKER) as c:
        for t in ["ingest.jobs", "market.listings", "app.notes", "auth.users", "stats.observations"]:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                c.execute(f"select 1 from {t} limit 1")
            c.rollback()


def test_atomic_claim_only_one_worker_wins(db, enqueue, clean_queue):
    jid = enqueue("test.noop", "test")
    a, b = api(), api()
    wa, wb = a.register("w-a", "h", "t", []), b.register("w-b", "h", "t", [])
    results = []
    barrier = threading.Barrier(2)

    def go(x, w):
        barrier.wait()
        results.append(x.claim(w, ["test.noop"], 60))
    ts = [threading.Thread(target=go, args=(a, wa)), threading.Thread(target=go, args=(b, wb))]
    [t.start() for t in ts]; [t.join() for t in ts]
    claims = [r for r in results if r]
    assert len(claims) == 1 and claims[0].job_id == jid


def test_expired_lease_is_reclaimed_and_old_run_cannot_write(db, admin, enqueue, clean_queue):
    enqueue("test.noop", "test")
    a, b = api(), api()
    wa, wb = a.register("w-old", "h", "t", []), b.register("w-new", "h", "t", [])
    old = a.claim(wa, ["test.noop"], 30)
    admin.execute("update ingest.runs set lease_expires_at = now() - interval '1 second' where id = %s", (old.run_id,))
    admin.execute("update ingest.jobs set lease_expires_at = now() - interval '1 second' where id = %s", (old.job_id,))
    with pytest.raises(LeaseLost):
        a.submit_observations(old, [])                                    # caducada: no puede escribir
    new = b.claim(wb, ["test.noop"], 60)
    assert new.job_id == old.job_id and new.attempt == 2
    with pytest.raises(LeaseLost):
        a.renew(old, 60, None)                                            # un trabajador antiguo no sobrescribe
    with pytest.raises(LeaseLost):
        a.finish(old, "completed", {}, {}, False)
    assert b.finish(new, "completed", {}, {}, False) == "completed"
    assert admin.execute("select status from ingest.runs where id=%s", (old.run_id,)).fetchone()["status"] == "lease_lost"


def test_cooperative_cancellation(db, enqueue, settings, clean_queue):
    jid = enqueue("test.slow", "test")
    started = threading.Event()

    def slow(ctx):
        started.set()
        for _ in range(400):           # hasta 20 s; la renovación (cada 5 s) detecta la petición de cancelar
            time.sleep(0.05)
            ctx.check()
        return Outcome()
    s = settings.__class__(**{**settings.__dict__, "lease_seconds": 15})
    t = threading.Thread(target=Runner(s, api(), {"test.slow": slow}).run_once)
    t.start()
    assert started.wait(5)
    with psycopg.connect(db, autocommit=True) as c:
        as_user(c, OWNER)
        assert c.execute("select ingest.request_cancel(%s)", (jid,)).fetchone()[0] == "running"
    t.join(25)
    with psycopg.connect(db) as c:
        assert c.execute("select status from ingest.jobs where id=%s", (jid,)).fetchone()[0] == "cancelled"


def test_retry_with_backoff_then_fail(db, admin, enqueue, settings, clean_queue):
    jid = enqueue("test.flaky", "test", max_attempts=2)

    def flaky(ctx):
        raise RetryableError("HTTP 503")
    r = Runner(settings, api(), {"test.flaky": flaky})
    assert r.run_once()
    j = admin.execute("select status, attempts, next_retry_at > now() as later from ingest.jobs where id=%s", (jid,)).fetchone()
    assert (j["status"], j["attempts"], j["later"]) == ("pending", 1, True)
    assert r.run_once() is False                                           # espera creciente: aún no
    admin.execute("update ingest.jobs set next_retry_at = now() where id=%s", (jid,))
    assert r.run_once()
    assert admin.execute("select status from ingest.jobs where id=%s", (jid,)).fetchone()["status"] == "failed"


def test_blocked_source_is_not_retried(db, admin, enqueue, settings, clean_queue):
    jid = enqueue("listings.idealista_api", "idealista_api")
    from inmo_worker.registry import HANDLERS
    Runner(settings, api(), {"listings.idealista_api": HANDLERS["listings.idealista_api"]}).run_once()
    j = admin.execute("select status, last_error from ingest.jobs where id=%s", (jid,)).fetchone()
    assert j["status"] == "failed" and "credenciales" in j["last_error"]
    assert admin.execute("select count(*) n from ingest.issues where job_id=%s and code='SOURCE_BLOCKED'", (jid,)).fetchone()["n"] == 1


def test_restart_recovers_running_job_from_checkpoint(db, admin, enqueue, settings, clean_queue):
    jid = enqueue("test.resume", "test")
    seen = []

    def crashy(ctx):
        seen.append(dict(ctx.claim.checkpoints))
        ctx.checkpoint("step", (ctx.claim.checkpoints.get("step") or 0) + 1)
        if len(seen) == 1:
            raise KeyboardInterrupt  # simula apagado del PC a mitad de trabajo
        return Outcome()
    r = Runner(settings, api(), {"test.resume": crashy})
    with pytest.raises(KeyboardInterrupt):
        r.run_once()
    admin.execute("update ingest.jobs set lease_expires_at = now() - interval '1 s' where id=%s", (jid,))
    admin.execute("update ingest.runs set lease_expires_at = now() - interval '1 s' where job_id=%s", (jid,))
    assert Runner(settings, api(), {"test.resume": crashy}).run_once()
    assert seen[1] == {"step": 1}
    assert admin.execute("select status, attempts from ingest.jobs where id=%s", (jid,)).fetchone() == {"status": "completed", "attempts": 2}


def test_revoked_worker_cannot_claim(db, admin, enqueue, clean_queue):
    enqueue("test.noop", "test")
    a = api()
    w = a.register("w-revoked", "h", "t", [])
    admin.execute("update ingest.workers set revoked_at = now() where id=%s", (w,))
    with pytest.raises(psycopg.errors.RaiseException):
        a.claim(w, ["test.noop"], 60)


def test_only_owner_can_enqueue_or_read_jobs(db):
    with psycopg.connect(db, autocommit=True) as c:
        as_user(c, OTHER)
        with pytest.raises(psycopg.errors.RaiseException):
            c.execute("select ingest.enqueue_job('test.noop','test','{}','{}',100,null)")
        assert c.execute("select count(*) from ingest.jobs").fetchone()[0] == 0     # RLS: el miembro no ve la cola
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            c.execute("select ingest.worker_claim(gen_random_uuid(), array['x'], 60)")
