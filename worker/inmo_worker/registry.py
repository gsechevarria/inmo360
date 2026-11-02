"""Registro de tipos de trabajo → manejadores."""
from __future__ import annotations

from .connectors import browser_capture, geo, ine_tempus, listings
from .queue import JobContext, Outcome

DERIVABLE = ["demo.pop_growth_1y", "demo.pop_growth_5y", "demo.pop_growth_10y", "demo.pop_cagr_5y", "demo.pop_cagr_10y",
             "demo.density", "demo.masculinity_index", "pop.share.by_sex", "tour.places_per_dwelling", "market.offer"]


def handle_derive(ctx: JobContext) -> Outcome:
    codes = ctx.claim.params.get("indicators") or DERIVABLE
    unknown = set(codes) - set(DERIVABLE)
    if unknown:
        raise ValueError(f"derivados desconocidos: {sorted(unknown)}")
    r = ctx.api.compute_derived(ctx.claim, list(codes))
    ctx.api.refresh_latest(ctx.claim)       # agregado de "último dato disponible" para la web
    return Outcome("completed", {"derived": r}, {"indicators": list(codes)}, True)


HANDLERS = {
    "geo.es_atlas": geo.handle_es_atlas,
    "geo.cnig": geo.handle_cnig,
    "stats.ine_tempus": ine_tempus.handle,
    "stats.browser_capture": browser_capture.handle,
    "stats.derive": handle_derive,
    "listings.file_import": listings.handle_file_import,
    "listings.agency_jsonld": listings.handle_agency_jsonld,
    "listings.feed_kyero": listings.handle_feed_kyero,
    "listings.idealista_api": listings.handle_idealista,
}
