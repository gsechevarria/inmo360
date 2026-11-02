"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import { fmtUnit, n, periodLabel } from "@/lib/format";

const SEQ = ["#e8f1f8", "#c3dbec", "#8fbcdb", "#5797c4", "#2b6ea3", "#123a5c"];
const SPAIN: [number, number, number, number] = [-9.6, 35.8, 4.5, 43.9];
const CANARIAS: [number, number, number, number] = [-18.3, 27.5, -13.3, 29.5];

export interface LegendData { code: string; n: number; universe: number; breaks: number[]; periods: { period: string; n: number }[]; min: number | null; max: number | null }

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hatch(): ImageData {
  const c = document.createElement("canvas"); c.width = c.height = 8;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e4e7eb"; g.fillRect(0, 0, 8, 8);
  g.strokeStyle = "#b9c0c9"; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
  return g.getImageData(0, 0, 8, 8);
}

function colorExpr(breaks: number[]) {
  if (!breaks.length) return "#8fbcdb";
  const e: unknown[] = ["step", ["get", "value"], SEQ[0]];
  breaks.forEach((b, i) => e.push(b, SEQ[Math.min(i + 1, SEQ.length - 1)]));
  return e as never;
}

export function ZoneMap({ indicator, unit, label, selectedProvinces, highlight, onSelect, className = "" }: {
  indicator: string; unit: string; label: string; selectedProvinces: string[]; highlight: string[]; onSelect?: (code: string) => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [legend, setLegend] = useState<LegendData | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; name: string; code: string; value?: number; period?: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // Inicialización
  useEffect(() => {
    if (!ref.current) return;
    const origin = window.location.origin;
    const basemap = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL;
    const style: StyleSpecification | string = basemap || {
      version: 8, sources: {},
      layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef2f5" } }],
    };
    const map = new maplibregl.Map({ container: ref.current, style, bounds: SPAIN, fitBoundsOptions: { padding: 12 }, attributionControl: false,
                                     dragRotate: false, pitchWithRotate: false, maxZoom: 13, minZoom: 3 });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Límites: IGN/CNIG vía es-atlas (CC BY 4.0) · Datos: INE" }), "bottom-right");
    map.on("error", (e) => { if (String(e.error?.message ?? "").includes("401")) setError("Sesión caducada"); });
    map.on("load", () => {
      map.addImage("hatch", hatch(), { pixelRatio: 1 });
      map.addSource("zones", { type: "vector", tiles: [`${origin}/api/tiles/municipality/{z}/{x}/{y}?ind=${indicator}`], minzoom: 4, maxzoom: 12 });
      map.addSource("provs", { type: "vector", tiles: [`${origin}/api/tiles/province/{z}/{x}/{y}`], minzoom: 3, maxzoom: 9 });
      map.addLayer({ id: "zones-nodata", type: "fill", source: "zones", "source-layer": "zones", filter: ["!", ["has", "value"]], paint: { "fill-pattern": "hatch", "fill-opacity": 0.9 } });
      map.addLayer({ id: "zones-fill", type: "fill", source: "zones", "source-layer": "zones", filter: ["has", "value"], paint: { "fill-color": "#8fbcdb", "fill-opacity": 0.92 } });
      map.addLayer({ id: "zones-line", type: "line", source: "zones", "source-layer": "zones", paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.15, 9, 0.8] } });
      map.addLayer({ id: "provs-line", type: "line", source: "provs", "source-layer": "zones", paint: { "line-color": "#123a5c", "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.6] } });
      map.addLayer({ id: "sel-prov", type: "line", source: "provs", "source-layer": "zones", filter: ["in", ["get", "code"], ["literal", []]], paint: { "line-color": "#f0a500", "line-width": 2.5 } });
      map.addLayer({ id: "sel-muni", type: "line", source: "zones", "source-layer": "zones", filter: ["in", ["get", "code"], ["literal", []]], paint: { "line-color": "#f0a500", "line-width": 2.2 } });
      map.on("mousemove", "zones-fill", (e) => showHover(e));
      map.on("mousemove", "zones-nodata", (e) => showHover(e));
      map.on("mouseleave", "zones-fill", () => setHover(null));
      map.on("mouseleave", "zones-nodata", () => setHover(null));
      const click = (e: maplibregl.MapLayerMouseEvent) => { const f = e.features?.[0]; if (f) onSelectRef.current?.(String(f.properties.code)); };
      map.on("click", "zones-fill", click);
      map.on("click", "zones-nodata", click);
      setReady(true);
    });
    function showHover(e: maplibregl.MapLayerMouseEvent) {
      const f = e.features?.[0];
      map.getCanvas().style.cursor = f ? "pointer" : "";
      if (f) setHover({ x: e.point.x, y: e.point.y, name: String(f.properties.name), code: String(f.properties.code),
                        value: f.properties.value as number | undefined, period: f.properties.period as string | undefined });
    }
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Indicador → teselas y leyenda
  useEffect(() => {
    const ctl = new AbortController();
    setLegend(null);
    fetch(`/api/zones/legend?ind=${indicator}`, { signal: ctl.signal }).then((r) => r.json()).then(setLegend).catch(() => {});
    const map = mapRef.current;
    if (map && ready) {
      const src = map.getSource("zones") as maplibregl.VectorTileSource | undefined;
      src?.setTiles([`${window.location.origin}/api/tiles/municipality/{z}/{x}/{y}?ind=${indicator}`]);
    }
    return () => ctl.abort();
  }, [indicator, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready && legend) map.setPaintProperty("zones-fill", "fill-color", colorExpr(legend.breaks));
  }, [legend, ready]);

  // Selección de provincias → encuadre del mapa (corrección respecto a la referencia)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setFilter("sel-prov", ["in", ["get", "code"], ["literal", selectedProvinces]]);
    if (!selectedProvinces.length) return;
    const ctl = new AbortController();
    fetch(`/api/geo/bbox?level=province&codes=${selectedProvinces.join(",")}`, { signal: ctl.signal }).then((r) => r.json())
      .then((d: { bbox: [number, number, number, number] | null }) => {
        if (d.bbox) map.fitBounds([[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[3]]], { padding: 24, duration: reducedMotion() ? 0 : 600 });
      }).catch(() => {});
    return () => ctl.abort();
  }, [selectedProvinces.join(","), ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) map.setFilter("sel-muni", ["in", ["get", "code"], ["literal", highlight]]);
  }, [highlight.join(","), ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = (b: [number, number, number, number]) => mapRef.current?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 12, duration: reducedMotion() ? 0 : 500 });

  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-[#eef2f5] ${className}`}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} role="region" aria-label={`Mapa de municipios coloreado por ${label}`} />
      <div className="absolute left-2 top-2 z-10 flex gap-1">
        <button className="btn py-1 text-[12px]" onClick={() => jump(SPAIN)}>Península y Baleares</button>
        <button className="btn py-1 text-[12px]" onClick={() => jump(CANARIAS)}>Canarias</button>
        <button className="btn py-1 text-[12px]" onClick={() => jump([-5.45, 35.8, -5.25, 35.95])}>Ceuta</button>
        <button className="btn py-1 text-[12px]" onClick={() => jump([-3.0, 35.26, -2.9, 35.32])}>Melilla</button>
      </div>
      {hover && (
        <div className="pointer-events-none absolute z-10 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12.5px] shadow"
             style={{ left: Math.min(hover.x + 12, 9999), top: hover.y + 12 }}>
          <div className="font-medium">{hover.name} <span className="meta code">{hover.code}</span></div>
          <div className="num">{hover.value === undefined ? <span className="text-ink-3">Sin dato</span> : fmtUnit(hover.value, unit)} <span className="meta">{periodLabel(hover.period)}</span></div>
        </div>
      )}
      {error && <div role="alert" className="absolute inset-x-2 top-12 z-10 rounded bg-neg-50 px-2 py-1 text-[12px] text-neg">{error}</div>}
      <MapLegend legend={legend} unit={unit} label={label} />
    </div>
  );
}

export function MapLegend({ legend, unit, label }: { legend: LegendData | null; unit: string; label: string }) {
  return (
    <div className="absolute bottom-2 left-2 z-10 max-w-[calc(100%-16px)] rounded-md border border-line bg-surface/95 p-2 text-[11.5px] shadow-sm">
      <div className="font-semibold text-ink">{label}</div>
      {!legend ? <div className="meta">Cargando leyenda…</div> : (
        <>
          <div className="mt-1 flex items-end gap-0.5" role="list" aria-label="Clases de la leyenda">
            {[legend.min, ...legend.breaks].map((b, i) => (
              <div key={i} role="listitem" className="flex flex-col items-start">
                <span className="h-2.5 w-9" style={{ background: SEQ[Math.min(i, SEQ.length - 1)] }} />
                <span className="meta num">{b === null ? "" : i === 0 ? `≥ ${fmtUnit(b, unit).replace(" personas", "")}` : `${fmtUnit(b, unit).replace(" personas", "")}`}</span>
              </div>
            ))}
            <div className="ml-1 flex flex-col items-start"><span className="hatch h-2.5 w-9 border border-line" /><span className="meta">Sin dato</span></div>
          </div>
          <div className="meta mt-1">
            Cobertura: {n(legend.n)} de {n(legend.universe)} municipios ·{" "}
            {legend.periods.slice(0, 2).map((p) => `${periodLabel(p.period)} (${n(p.n)})`).join(", ")}{legend.periods.length > 2 ? "…" : ""}
          </div>
          <div className="meta">Clases por sextiles de los municipios con dato. Un municipio sin dato no se rellena con el de su provincia.</div>
        </>
      )}
    </div>
  );
}
