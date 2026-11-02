"""Pruebas del trabajador. Las marcadas `db` usan una base AISLADA (nunca la operativa):
INMO_TEST_ADMIN_URL (superusuario local) y la recrean con scripts/local/db-reset.sh."""
from __future__ import annotations

import json
import os
import subprocess
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.rows import dict_row

ROOT = Path(__file__).resolve().parents[2]
ADMIN = os.environ.get("INMO_TEST_ADMIN_URL", "postgresql://postgres:postgres@127.0.0.1:5432/inmo360_test")
WORKER = os.environ.get("INMO_TEST_WORKER_URL", "postgresql://inmo_worker:worker_local_only@127.0.0.1:5432/inmo360_test")
OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"


def _db_available() -> bool:
    try:
        psycopg.connect(ADMIN.rsplit("/", 1)[0] + "/postgres", connect_timeout=2).close()
        return True
    except Exception:
        return False


@pytest.fixture(scope="session")
def db():
    if not _db_available():
        pytest.skip("Base aislada de pruebas no disponible")
    subprocess.run([str(ROOT / "scripts/local/db-reset.sh"), "inmo360_test"], check=True, capture_output=True)
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute((ROOT / "supabase/seed/010_catalog.sql").read_text(encoding="utf-8"))
        c.execute((ROOT / "scripts/local/dev-owner.sql").read_text(encoding="utf-8"))
        c.execute("insert into auth.users(id,email) values (%s,'otro@inmo360.local') on conflict do nothing", (OTHER,))
        c.execute("insert into app.user_profiles(user_id, role) values (%s,'member') on conflict do nothing", (OTHER,))
        # Territorios mínimos para pruebas (códigos con ceros iniciales)
        c.execute("""
          insert into geo.geographies(level, code, name) values ('country','ES','España');
          insert into geo.geographies(level, code, name, parent_id) select 'ccaa','08','Castilla-La Mancha', id from geo.geographies where code='ES';
          insert into geo.geographies(level, code, name, parent_id) select 'province','02','Albacete', id from geo.geographies where level='ccaa' and code='08';
          insert into geo.geographies(level, code, name, parent_id) select 'municipality','02003','Albacete', id from geo.geographies where level='province' and code='02';
          insert into geo.geographies(level, code, name, parent_id) select 'municipality','02001','Abengibre', id from geo.geographies where level='province' and code='02';
        """)
    yield ADMIN


@pytest.fixture()
def admin(db):
    with psycopg.connect(db, autocommit=True, row_factory=dict_row) as c:
        yield c


def as_user(conn, user_id: str):
    conn.execute("set role authenticated")
    conn.execute("select set_config('request.jwt.claims', %s, false)", (json.dumps({"sub": user_id, "role": "authenticated"}),))


@pytest.fixture()
def enqueue(db):
    def _enq(job_type: str, source: str, params: dict | None = None, priority: int = 100, max_attempts: int | None = None) -> str:
        with psycopg.connect(db, autocommit=True, row_factory=dict_row) as c:
            as_user(c, OWNER)
            jid = c.execute("select ingest.enqueue_job(%s,%s,'{}'::jsonb,%s::jsonb,%s,%s) as id",
                            (job_type, source, json.dumps(params or {}), priority, str(uuid.uuid4()))).fetchone()["id"]
            c.execute("reset role")
            if max_attempts:
                c.execute("update ingest.jobs set max_attempts=%s where id=%s", (max_attempts, jid))
            return str(jid)
    return _enq


@pytest.fixture()
def clean_queue(admin):
    admin.execute("update ingest.jobs set status='cancelled' where status in ('pending','running')")
    yield


@pytest.fixture()
def settings(tmp_path):
    from inmo_worker.config import Settings
    (tmp_path / "inbox").mkdir()
    return Settings(database_url=WORKER, worker_name=f"test-{uuid.uuid4().hex[:8]}", data_dir=tmp_path, lease_seconds=30,
                    poll_seconds=0.1, batch_size=50)
