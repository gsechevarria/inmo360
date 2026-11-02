"""Almacenamiento de medios: proveedor local (activo) y Supabase Storage (preparado, no activado).

Claves de negocio RELATIVAS y estables: `media/<sha[:2]>/<sha>.<ext>`. Nunca rutas absolutas de Windows.
Escritura segura: temporal → validar tipo/tamaño → huella → renombrado atómico → registrar disponible.
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Protocol

ALLOWED_MIME = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
    "application/pdf": "pdf", "text/html": "html",
}
MAGIC = [(b"\xff\xd8\xff", "image/jpeg"), (b"\x89PNG\r\n\x1a\n", "image/png"), (b"GIF8", "image/gif"),
         (b"%PDF-", "application/pdf")]


class StorageError(Exception):
    pass


def sniff_mime(head: bytes, declared: str | None) -> str | None:
    for sig, mime in MAGIC:
        if head.startswith(sig):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:12] in (b"ftypavif", b"ftypavis"):
        return "image/avif"
    if declared == "text/html" and head.lstrip()[:1] == b"<":
        return "text/html"
    return None


def image_size(data: bytes, mime: str) -> tuple[int | None, int | None]:
    try:
        if mime == "image/png" and len(data) >= 24:
            return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")
        if mime == "image/gif" and len(data) >= 10:
            return int.from_bytes(data[6:8], "little"), int.from_bytes(data[8:10], "little")
        if mime == "image/jpeg":
            i = 2
            while i + 9 < len(data):
                if data[i] != 0xFF:
                    i += 1; continue
                marker = data[i + 1]
                if marker in (0xC0, 0xC1, 0xC2):
                    return int.from_bytes(data[i + 7:i + 9], "big"), int.from_bytes(data[i + 5:i + 7], "big")
                i += 2 + int.from_bytes(data[i + 2:i + 4], "big")
    except Exception:
        pass
    return None, None


def validate_key(key: str) -> str:
    k = key.replace("\\", "/")
    if k.startswith("/") or ":" in k.split("/")[0] or ".." in k.split("/") or not k:
        raise StorageError(f"clave no válida: {key!r}")
    return k


@dataclass(frozen=True)
class StoredObject:
    key: str
    sha256: str
    byte_size: int
    mime_type: str
    width: int | None
    height: int | None
    deduplicated: bool


class StorageProvider(Protocol):
    name: str
    def put_bytes(self, data: bytes, declared_mime: str | None, prefix: str = "media") -> StoredObject: ...
    def exists(self, key: str) -> bool: ...
    def open(self, key: str) -> bytes: ...
    def verify(self, key: str, sha256: str) -> bool: ...


class LocalStorage:
    name = "local"

    def __init__(self, root: Path, max_bytes: int = 15 * 1024 * 1024):
        self.root = Path(root).resolve()
        self.max_bytes = max_bytes
        (self.root / "tmp").mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / validate_key(key)).resolve()
        if self.root not in p.parents:
            raise StorageError("la clave sale del almacén")
        return p

    def put_bytes(self, data: bytes, declared_mime: str | None, prefix: str = "media") -> StoredObject:
        if len(data) == 0:
            raise StorageError("archivo vacío")
        if len(data) > self.max_bytes:
            raise StorageError(f"archivo demasiado grande ({len(data)} bytes)")
        mime = sniff_mime(data[:64], declared_mime)
        if mime not in ALLOWED_MIME:
            raise StorageError(f"tipo no permitido (declarado {declared_mime!r})")
        sha = hashlib.sha256(data).hexdigest()
        key = f"{prefix}/{sha[:2]}/{sha}.{ALLOWED_MIME[mime]}"
        dest = self._path(key)
        w, h = image_size(data, mime)
        if dest.exists() and self.verify(key, sha):
            return StoredObject(key, sha, len(data), mime, w, h, deduplicated=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.root / "tmp", suffix=".part")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
                f.flush()
                os.fsync(f.fileno())
            if hashlib.sha256(Path(tmp).read_bytes()).hexdigest() != sha:
                raise StorageError("la huella no coincide tras escribir")
            os.replace(tmp, dest)            # atómico en el mismo volumen
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return StoredObject(key, sha, len(data), mime, w, h, deduplicated=False)

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def open(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def verify(self, key: str, sha256: str) -> bool:
        p = self._path(key)
        return p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest() == sha256


class SupabaseStorage:
    """Proveedor futuro (NO activado en el MVP). Sube por la API REST de Storage con la misma clave."""
    name = "supabase"

    def __init__(self, project_url: str, service_key: str, bucket: str, transport=None):
        import httpx
        self.base = project_url.rstrip("/") + "/storage/v1"
        self.bucket = bucket
        self.http = httpx.Client(timeout=60, transport=transport,
                                 headers={"Authorization": f"Bearer {service_key}", "apikey": service_key})

    def upload(self, key: str, data: bytes, mime: str) -> None:
        r = self.http.post(f"{self.base}/object/{self.bucket}/{validate_key(key)}", content=data,
                           headers={"Content-Type": mime, "x-upsert": "false"})
        if r.status_code not in (200, 201, 409):     # 409: ya existe (reanudación)
            raise StorageError(f"subida fallida {r.status_code}: {r.text[:200]}")

    def download(self, key: str) -> bytes:
        r = self.http.get(f"{self.base}/object/{self.bucket}/{validate_key(key)}")
        if r.status_code != 200:
            raise StorageError(f"descarga fallida {r.status_code}")
        return r.content

    def verify(self, key: str, sha256: str) -> bool:
        try:
            return hashlib.sha256(self.download(key)).hexdigest() == sha256
        except StorageError:
            return False


@dataclass
class MigrationItem:
    media_id: str
    key: str
    sha256: str
    mime_type: str


def migrate(items: Iterable[MigrationItem], src: LocalStorage, dst: SupabaseStorage, journal: Path,
            dry_run: bool = True) -> dict:
    """Migración reanudable local → Supabase. Conserva claves, verifica y NO borra originales.

    El diario (JSONL) registra cada clave verificada; al reanudar se omiten. El cambio de proveedor
    en la base (storage_provider='supabase', status='migrated') se hace aparte y solo con claves verificadas.
    """
    done = set()
    if journal.exists():
        done = {json.loads(l)["key"] for l in journal.read_text(encoding="utf-8").splitlines() if l.strip()}
    res = {"pending": 0, "uploaded": 0, "verified": 0, "skipped": 0, "failed": 0}
    with journal.open("a", encoding="utf-8") as j:
        for it in items:
            if it.key in done:
                res["skipped"] += 1; continue
            res["pending"] += 1
            if dry_run:
                continue
            try:
                if not src.verify(it.key, it.sha256):
                    raise StorageError("original local ausente o alterado")
                dst.upload(it.key, src.open(it.key), it.mime_type)
                res["uploaded"] += 1
                if dst.verify(it.key, it.sha256):
                    res["verified"] += 1
                    j.write(json.dumps({"key": it.key, "media_id": it.media_id, "sha256": it.sha256}) + "\n")
                else:
                    res["failed"] += 1
            except StorageError:
                res["failed"] += 1
    return res
