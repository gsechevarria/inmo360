"""Configuración del trabajador (variables de entorno o fichero .env junto al trabajador).

Nunca se registran secretos en logs: `Settings.redacted()` es lo único que se imprime.
"""
from __future__ import annotations

import os
import socket
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


def _bool(v: str | None, default: bool = False) -> bool:
    return default if v is None else v.strip().lower() in {"1", "true", "yes", "si", "sí"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    worker_name: str
    data_dir: Path                      # raíz del almacén local (medios, instantáneas, buzón)
    lease_seconds: int = 120
    poll_seconds: float = 10.0
    batch_size: int = 200
    user_agent: str = "Inmo360Worker/0.1 (uso privado; +https://github.com/)"
    contact_email: str | None = None
    http_min_interval_s: float = 2.0    # cortesía por host
    http_timeout_s: float = 30.0
    max_media_bytes: int = 15 * 1024 * 1024
    download_media: bool = False        # por defecto no se descargan fotos
    idealista_key: str | None = None
    idealista_secret: str | None = None
    job_types: tuple[str, ...] = ()
    extra: dict = field(default_factory=dict)

    @property
    def inbox_dir(self) -> Path:
        return self.data_dir / "inbox"

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media-store"

    def redacted(self) -> dict:
        url = self.database_url
        if "@" in url and "://" in url:
            scheme, rest = url.split("://", 1)
            creds, host = rest.split("@", 1)
            url = f"{scheme}://{creds.split(':', 1)[0]}:***@{host}"
        return {"database_url": url, "worker_name": self.worker_name, "data_dir": str(self.data_dir),
                "lease_seconds": self.lease_seconds, "download_media": self.download_media,
                "idealista": "configurado" if self.idealista_key else "sin credenciales"}


def load_settings(env_file: str | os.PathLike | None = None) -> Settings:
    if env_file:
        load_dotenv(env_file, override=False)
    else:
        load_dotenv(Path.cwd() / ".env", override=False)
    url = os.environ.get("INMO_WORKER_DATABASE_URL")
    if not url:
        raise SystemExit("Falta INMO_WORKER_DATABASE_URL (rol inmo_worker; ver worker/.env.example)")
    data_dir = Path(os.environ.get("INMO_DATA_DIR", Path.home() / "Inmo360Data")).expanduser().resolve()
    jt = os.environ.get("INMO_JOB_TYPES", "")
    return Settings(
        database_url=url,
        worker_name=os.environ.get("INMO_WORKER_NAME", f"pc-{socket.gethostname().lower()}"[:64]),
        data_dir=data_dir,
        lease_seconds=int(os.environ.get("INMO_LEASE_SECONDS", "120")),
        poll_seconds=float(os.environ.get("INMO_POLL_SECONDS", "10")),
        contact_email=os.environ.get("INMO_CONTACT_EMAIL"),
        http_min_interval_s=float(os.environ.get("INMO_HTTP_MIN_INTERVAL", "2.0")),
        download_media=_bool(os.environ.get("INMO_DOWNLOAD_MEDIA"), False),
        idealista_key=os.environ.get("IDEALISTA_API_KEY") or None,
        idealista_secret=os.environ.get("IDEALISTA_API_SECRET") or None,
        job_types=tuple(x.strip() for x in jt.split(",") if x.strip()),
    )
