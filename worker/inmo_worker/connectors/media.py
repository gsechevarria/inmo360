"""Descarga de fotografías a disco local (solo fuentes que lo permiten y si INMO_DOWNLOAD_MEDIA=1).

La web NO muestra fotos ni pide imágenes a los portales. Aquí solo se guardan bytes en local y se
registra el inventario (clave relativa, huella, tamaño, tipo) en Supabase.
"""
from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..normalize import url_hash
from ..queue import JobContext, SourceBlocked
from ..storage import LocalStorage, StorageError

MEDIA_ALLOWED_SOURCES = {"agency_web", "feed", "file_import"}   # nunca portales


def download_images(ctx: JobContext, client, storage: LocalStorage, listing_external_id: str, urls: list[str],
                    max_per_listing: int = 20) -> dict:
    if ctx.claim.source_code not in MEDIA_ALLOWED_SOURCES or not ctx.settings.download_media:
        return {"skipped": len(urls)}
    regs, res = [], {"available": 0, "failed": 0, "dedup": 0}
    for u in urls[:max_per_listing]:
        ctx.check()
        base = {"listing_external_id": listing_external_id, "kind": "photo", "origin_host": urlsplit(u).netloc,
                "origin_url_hash": url_hash(u), "captured_at": datetime.now(timezone.utc).isoformat()}
        try:
            r = client.get(u)
            if r.status_code != 200:
                raise StorageError(f"HTTP {r.status_code}")
            if int(r.headers.get("content-length") or 0) > storage.max_bytes:
                raise StorageError("demasiado grande")
            o = storage.put_bytes(r.content, r.headers.get("content-type"))
            regs.append({**base, "status": "available", "storage_key": o.key, "sha256": o.sha256, "byte_size": o.byte_size,
                         "mime_type": o.mime_type, "width": o.width, "height": o.height})
            res["dedup" if o.deduplicated else "available"] += 1
        except (StorageError, SourceBlocked) as e:
            regs.append({**base, "status": "failed", "error": str(e)[:300]})
            res["failed"] += 1
    if regs:
        ctx.submit("media", regs)
    return res
