"""Cliente de la API del trabajador. Solo llama a funciones ingest.worker_* (sin acceso a tablas)."""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row


class LeaseLost(RuntimeError):
    """La ejecución ya no es la vigente (reserva caducada o reasignada). Hay que detenerse sin escribir."""


@dataclass
class Claim:
    job_id: str
    run_id: str
    lease_token: str
    lease_expires_at: Any
    job_type: str
    source_code: str
    scope_requested: dict
    params: dict
    attempt: int
    checkpoints: dict


def _j(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False, default=str)


class WorkerAPI:
    def __init__(self, database_url: str):
        self._url = database_url
        self._lock = threading.Lock()   # una conexión compartida por el hilo principal y el de renovación
        self._conn: psycopg.Connection | None = None

    # -- conexión -----------------------------------------------------------
    def _c(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._url, autocommit=True, row_factory=dict_row,
                                         connect_timeout=15, application_name="inmo-worker",
                                         prepare_threshold=None)  # compatible con el pooler en modo transacción
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()

    def _call(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            try:
                with self._c().cursor() as cur:
                    cur.execute(sql, params)
                    return cur.fetchall() if cur.description else []
            except psycopg.errors.RaiseException as e:  # errores de negocio de las funciones
                msg = str(e).split("\n")[0]
                if any(k in msg for k in ("LEASE_LOST", "LEASE_EXPIRED", "LEASE_INVALID", "WORKER_REVOKED")):
                    raise LeaseLost(msg) from e
                raise
            except psycopg.OperationalError:
                self._conn = None
                raise

    # -- API ----------------------------------------------------------------
    def register(self, name: str, hostname: str, version: str, capabilities: list[str]) -> str:
        return str(self._call("select ingest.worker_register(%s,%s,%s,%s) as id",
                              (name, hostname, version, capabilities))[0]["id"])

    def heartbeat(self, worker_id: str) -> None:
        self._call("select ingest.worker_heartbeat(%s)", (worker_id,))

    def claim(self, worker_id: str, job_types: list[str], lease_seconds: int) -> Claim | None:
        rows = self._call("select * from ingest.worker_claim(%s,%s,%s)", (worker_id, job_types, lease_seconds))
        if not rows:
            return None
        r = rows[0]
        return Claim(job_id=str(r["job_id"]), run_id=str(r["run_id"]), lease_token=str(r["lease_token"]),
                     lease_expires_at=r["lease_expires_at"], job_type=r["job_type"], source_code=r["source_code"],
                     scope_requested=r["scope_requested"] or {}, params=r["params"] or {}, attempt=r["attempt"],
                     checkpoints=r["checkpoints"] or {})

    def renew(self, c: Claim, lease_seconds: int, progress: dict | None) -> bool:
        return bool(self._call("select ingest.worker_renew(%s,%s,%s,%s::jsonb) as cancel",
                               (c.run_id, c.lease_token, lease_seconds, _j(progress) if progress else None))[0]["cancel"])

    def checkpoint(self, c: Claim, key: str, value: Any) -> None:
        self._call("select ingest.worker_save_checkpoint(%s,%s,%s,%s::jsonb)", (c.run_id, c.lease_token, key, _j(value)))

    def issue(self, c: Claim, severity: str, code: str, message: str, context: dict | None = None) -> None:
        self._call("select ingest.worker_report_issue(%s,%s,%s,%s,%s,%s::jsonb)",
                   (c.run_id, c.lease_token, severity, code, message[:2000], _j(context or {})))

    def snapshot(self, c: Claim, item: dict) -> str:
        return str(self._call("select ingest.worker_register_snapshot(%s,%s,%s::jsonb) as id",
                              (c.run_id, c.lease_token, _j(item)))[0]["id"])

    def submit_geographies(self, c: Claim, items: list[dict]) -> dict:
        return self._call("select ingest.worker_submit_geographies(%s,%s,%s::jsonb) as r", (c.run_id, c.lease_token, _j(items)))[0]["r"]

    def submit_geo_relations(self, c: Claim, items: list[dict]) -> int:
        return self._call("select ingest.worker_submit_geo_relations(%s,%s,%s::jsonb) as r", (c.run_id, c.lease_token, _j(items)))[0]["r"]

    def submit_observations(self, c: Claim, items: list[dict]) -> dict:
        return self._call("select ingest.worker_submit_observations(%s,%s,%s::jsonb) as r", (c.run_id, c.lease_token, _j(items)))[0]["r"]

    def submit_listings(self, c: Claim, items: list[dict]) -> dict:
        return self._call("select ingest.worker_submit_listings(%s,%s,%s::jsonb) as r", (c.run_id, c.lease_token, _j(items)))[0]["r"]

    def register_media(self, c: Claim, items: list[dict]) -> dict:
        return self._call("select ingest.worker_register_media(%s,%s,%s::jsonb) as r", (c.run_id, c.lease_token, _j(items)))[0]["r"]

    def compute_derived(self, c: Claim, indicator_codes: list[str]) -> dict:
        return self._call("select ingest.worker_compute_derived(%s,%s,%s) as r", (c.run_id, c.lease_token, indicator_codes))[0]["r"]

    def finish(self, c: Claim, status: str, stats: dict, scope_covered: dict, coverage_complete: bool,
               error: str | None = None, retryable: bool = False) -> str:
        return self._call("select ingest.worker_finish(%s,%s,%s,%s::jsonb,%s::jsonb,%s,%s,%s) as r",
                          (c.run_id, c.lease_token, status, _j(stats), _j(scope_covered), coverage_complete, error,
                           retryable))[0]["r"]
