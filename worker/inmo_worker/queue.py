"""Bucle del trabajador: reserva, renovación de reserva, cancelación cooperativa, cierre y reintentos."""
from __future__ import annotations

import logging
import socket
import threading
import time
import traceback
from dataclasses import dataclass, field
from typing import Any, Callable

from . import __version__
from .config import Settings
from .db import Claim, LeaseLost, WorkerAPI

log = logging.getLogger("inmo_worker")


class JobCancelled(Exception):
    pass


class SourceBlocked(Exception):
    """La fuente exige credenciales/autorización que no existen. No se reintenta."""


class RetryableError(Exception):
    """Error transitorio (red, 5xx…). Se reintenta con espera creciente."""


@dataclass
class Outcome:
    status: str = "completed"                      # completed | partial
    stats: dict = field(default_factory=dict)
    scope_covered: dict = field(default_factory=dict)
    coverage_complete: bool = False


class JobContext:
    """Lo que ve un conector: API acotada a SU ejecución y señales de cancelación/reserva."""

    def __init__(self, api: WorkerAPI, claim: Claim, settings: Settings):
        self.api, self.claim, self.settings = api, claim, settings
        self.progress: dict[str, Any] = {}
        self._cancel = threading.Event()
        self._lost = threading.Event()
        self._done = threading.Event()
        self._lost_reason = ""

    # Señales
    def check(self) -> None:
        if self._lost.is_set():
            raise LeaseLost(self._lost_reason or "reserva perdida")
        if self._cancel.is_set():
            raise JobCancelled()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    # Operaciones con la ejecución
    def set_progress(self, **kw: Any) -> None:
        self.progress.update(kw)

    def issue(self, severity: str, code: str, message: str, **context: Any) -> None:
        self.api.issue(self.claim, severity, code, message, context)

    def checkpoint(self, key: str, value: Any) -> None:
        self.check()
        self.api.checkpoint(self.claim, key, value)
        self.claim.checkpoints[key] = value

    def submit(self, kind: str, items: list[dict]) -> dict:
        """Envía por lotes; comprueba antes la vigencia de la reserva (fencing en servidor)."""
        self.check()
        fn = {"observations": self.api.submit_observations, "listings": self.api.submit_listings,
              "geographies": self.api.submit_geographies, "media": self.api.register_media,
              "geo_relations": self.api.submit_geo_relations}[kind]
        total: dict[str, int] = {}
        bs = 2000 if kind == "observations" else self.settings.batch_size
        for i in range(0, len(items), bs):
            self.check()
            r = fn(self.claim, items[i:i + bs])
            if isinstance(r, dict):
                for k, v in r.items():
                    if isinstance(v, (int, float)):
                        total[k] = total.get(k, 0) + v
        return total


Handler = Callable[[JobContext], Outcome]


class Runner:
    def __init__(self, settings: Settings, api: WorkerAPI, handlers: dict[str, Handler], renew_api: WorkerAPI | None = None):
        self.s, self.api, self.handlers = settings, api, handlers
        # Conexión separada para renovar la reserva: un envío largo no debe bloquear la renovación.
        self.renew_api = renew_api or WorkerAPI(settings.database_url)
        self.worker_id: str | None = None
        self._stop = threading.Event()

    def register(self) -> str:
        self.worker_id = self.api.register(self.s.worker_name, socket.gethostname()[:128], __version__, sorted(self.handlers))
        log.info("trabajador registrado %s (%s)", self.s.worker_name, self.worker_id)
        return self.worker_id

    def stop(self) -> None:
        self._stop.set()

    def run_forever(self) -> None:
        if not self.worker_id:
            self.register()
        last_hb = 0.0
        while not self._stop.is_set():
            try:
                if time.monotonic() - last_hb > 30:
                    self.api.heartbeat(self.worker_id)
                    last_hb = time.monotonic()
                if not self.run_once():
                    self._stop.wait(self.s.poll_seconds)
            except Exception as e:  # red caída, BD no disponible…: reintenta sin perder el bucle
                log.warning("bucle: %s", e)
                self._stop.wait(min(60, self.s.poll_seconds * 3))

    def run_once(self) -> bool:
        """Reserva y ejecuta un trabajo. Devuelve False si no había trabajo."""
        if not self.worker_id:
            self.register()
        types = list(self.s.job_types) or sorted(self.handlers)
        claim = self.api.claim(self.worker_id, types, self.s.lease_seconds)
        if claim is None:
            return False
        log.info("trabajo %s (%s, intento %s)", claim.job_id, claim.job_type, claim.attempt)
        ctx = JobContext(self.api, claim, self.s)
        renewer = threading.Thread(target=self._renew_loop, args=(ctx,), daemon=True)
        renewer.start()
        try:
            outcome = self.handlers[claim.job_type](ctx)
            ctx.check()
            final = self.api.finish(claim, outcome.status, outcome.stats, outcome.scope_covered, outcome.coverage_complete)
            log.info("trabajo %s → %s %s", claim.job_id, final, outcome.stats)
        except LeaseLost as e:
            log.warning("reserva perdida en %s: %s — se abandona sin escribir", claim.job_id, e)
        except JobCancelled:
            self._finish_safely(claim, "cancelled", ctx, "cancelado por el usuario", retryable=False)
        except SourceBlocked as e:
            self._issue_safely(ctx, "error", "SOURCE_BLOCKED", str(e))
            self._finish_safely(claim, "failed", ctx, str(e), retryable=False)
        except RetryableError as e:
            self._finish_safely(claim, "failed", ctx, str(e), retryable=True)
        except Exception as e:
            log.error("trabajo %s falló: %s", claim.job_id, traceback.format_exc())
            self._issue_safely(ctx, "error", "UNHANDLED", f"{type(e).__name__}: {e}")
            self._finish_safely(claim, "failed", ctx, f"{type(e).__name__}: {e}", retryable=True)
        finally:
            ctx._done.set()  # detiene el hilo de renovación
            renewer.join(timeout=5)
        return True

    def _renew_loop(self, ctx: JobContext) -> None:
        interval = max(5, self.s.lease_seconds // 3)
        while not ctx._done.wait(interval):
            try:
                if self.renew_api.renew(ctx.claim, self.s.lease_seconds, ctx.progress):
                    ctx._cancel.set()
            except LeaseLost as e:
                ctx._lost_reason = str(e)
                ctx._lost.set()
                return
            except Exception as e:  # error transitorio: se reintenta en el siguiente ciclo
                log.warning("renovación: %s", e)

    def _finish_safely(self, claim: Claim, status: str, ctx: JobContext, error: str, retryable: bool) -> None:
        try:
            self.api.finish(claim, status, {"progress": ctx.progress}, {}, False, error, retryable)
        except LeaseLost:
            log.warning("no se pudo cerrar %s: reserva perdida", claim.job_id)

    def _issue_safely(self, ctx: JobContext, sev: str, code: str, msg: str) -> None:
        try:
            ctx.issue(sev, code, msg)
        except LeaseLost:
            pass
