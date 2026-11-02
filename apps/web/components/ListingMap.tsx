"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type StyleSpecification } from "maplibre-gl";

const SPAIN: [number, number, number, number] = [-9.6, 35.8, 4.5, 43.9];
type Cluster = { lon: number; lat: number; n: number; approx: boolean; precision: string; id: string | null; median: number | null };

/**
 * Mapa de viviendas: agrupación en servidor por área visible (no se descargan todos los anuncios).
 * Ubicaciones aproximadas: círculo hueco con trazo discontinuo, nunca un punto aparentemente exacto.
 */
export function ListingMap({ query, fitCodes, selected, onSelect, onBounds, className = "" }: {
  query: string; fitCodes: { level: string; codes: string[] } | null; selected: string | null;
  onSelect: (id: string) => void; onBounds: (b: [number, number, number, number]) => void; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState<{ n: number; approx: number } | null>(null);
  const cb = useRef({ onSelect, onBounds });
  cb.current = { onSelect, onBounds };

  useEffect(() => {
    const origin = window.location.origin;
    const style: StyleSpecification | string = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL || {
      version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef2f5" } }] };
    const map = new maplibregl.Map({ container: ref.current!, style, bounds: SPAIN, attributionControl: false, dragRotate: false, maxZoom: 17 });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Límites IGN/CNIG vía es-atlas (CC BY 4.0)" }), "bottom-right");
    map.on("load", () => {
      map.addSource("munis", { type: "vector", tiles: [`${origin}/api/tiles/municipality/{z}/{x}/{y}`], minzoom: 5, maxzoom: 12 });
      map.addSource("provs", { type: "vector", tiles: [`${origin}/api/tiles/province/{z}/{x}/{y}`], maxzoom: 9 });
      map.addLayer({ id: "munis-fill", type: "fill", source: "munis", "source-layer": "zones", paint: { "fill-color": "#ffffff", "fill-opacity": 0.6 } });
      map.addLayer({ id: "munis-line", type: "line", source: "munis", "source-layer": "zones", paint: { "line-color": "#c3cbd4", "line-width": 0.5 } });
      map.addLayer({ id: "provs-line", type: "line", source: "provs", "source-layer": "zones", paint: { "line-color": "#123a5c", "line-width": 1 } });
      map.addSource("pts", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "approx", type: "circle", source: "pts", filter: ["==", ["get", "approx"], true],
        paint: { "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 12, 50, 26], "circle-color": "rgba(240,165,0,0.12)",
                 "circle-stroke-color": "#8a5a00", "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.9 } });
      map.addLayer({ id: "exact", type: "circle", source: "pts", filter: ["==", ["get", "approx"], false],
        paint: { "circle-radius": ["interpolate", ["linear"], ["get", "n"], 1, 6, 10, 12, 100, 22], "circle-color": "#1f5f8b",
                 "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "sel", type: "circle", source: "pts", filter: ["==", ["get", "id"], "__ninguno__"],
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#f0a500", "circle-stroke-width": 3 } });
      const click = (e: maplibregl.MapLayerMouseEvent) => {
        const f = e.features?.[0];
        if (!f) return;
        if (f.properties.id) cb.current.onSelect(String(f.properties.id));
        else map.easeTo({ center: e.lngLat, zoom: map.getZoom() + 2, duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 400 });
      };
      map.on("click", "exact", click);
      map.on("click", "approx", click);
      for (const l of ["exact", "approx"]) {
        map.on("mouseenter", l, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", l, () => (map.getCanvas().style.cursor = ""));
      }
      map.on("moveend", () => { const b = map.getBounds(); cb.current.onBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]); });
      setReady(true);
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  // Recarga de agrupaciones al mover el mapa o cambiar filtros (con cancelación de peticiones obsoletas)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let ctl = new AbortController();
    const load = () => {
      ctl.abort(); ctl = new AbortController();
      const b = map.getBounds();
      const p = new URLSearchParams(query);
      p.set("bbox", [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => x.toFixed(4)).join(","));
      p.set("z", String(Math.round(map.getZoom())));
      fetch(`/api/listings/clusters?${p}`, { signal: ctl.signal }).then((r) => r.json()).then((d: { clusters: Cluster[] }) => {
        (map.getSource("pts") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features: d.clusters.map((c) => ({
          type: "Feature", geometry: { type: "Point", coordinates: [c.lon, c.lat] }, properties: { n: c.n, approx: c.approx, id: c.id ?? "" } })) });
        setCount({ n: d.clusters.reduce((s, c) => s + c.n, 0), approx: d.clusters.filter((c) => c.approx).reduce((s, c) => s + c.n, 0) });
      }).catch(() => {});
    };
    load();
    map.on("moveend", load);
    return () => { map.off("moveend", load); ctl.abort(); };
  }, [query, ready]);

  useEffect(() => {
    if (mapRef.current && ready) mapRef.current.setFilter("sel", ["==", ["get", "id"], selected ?? "__ninguno__"]);
  }, [selected, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fitCodes?.codes.length) return;
    fetch(`/api/geo/bbox?level=${fitCodes.level}&codes=${fitCodes.codes.join(",")}`).then((r) => r.json()).then((d) => {
      if (d.bbox) map.fitBounds([[d.bbox[0], d.bbox[1]], [d.bbox[2], d.bbox[3]]], { padding: 30, duration: 0, maxZoom: 13 });
    }).catch(() => {});
  }, [fitCodes?.level, fitCodes?.codes.join(","), ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative overflow-hidden rounded-lg border border-line bg-[#eef2f5] ${className}`}>
      <div ref={ref} style={{ position: "absolute", inset: 0 }} role="region" aria-label="Mapa de viviendas" />
      <div className="absolute bottom-2 left-2 z-10 rounded-md border border-line bg-surface/95 p-2 text-[11.5px] shadow-sm">
        <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full border-2 border-white bg-brand-2" /> Ubicación exacta o de calle</div>
        <div className="flex items-center gap-2"><span className="inline-block h-3.5 w-3.5 rounded-full border-[1.5px] border-warn bg-warn-50" /> Ubicación aproximada (círculo ámbar: zona o municipio)</div>
        {count && <div className="meta mt-0.5">En vista: {count.n} inmuebles · {count.approx} aproximados. Agrupados en servidor.</div>}
      </div>
    </div>
  );
}
