"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "./icons";

type Hit = { kind: "geo" | "property"; id: string; label: string; sub: string; href: string };

/** Búsqueda por nombre o código (INE) de territorios y por referencia de anuncio. Debounce + cancelación. */
export function GlobalSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal }).then((r) => r.json())
        .then((d: { hits: Hit[] }) => { setHits(d.hits); setActive(0); setOpen(true); }).catch(() => {});
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const go = (h: Hit) => { setOpen(false); setQ(""); router.push(h.href); };
  return (
    <div className="relative w-full max-w-md sm:w-80">
      <label htmlFor="gsearch" className="sr-only">Buscar municipio, provincia o código INE</label>
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"><IconSearch /></span>
      <input id="gsearch" ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar municipio, provincia o código INE  ( / )"
        className="input pl-9" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" autoComplete="off"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
          if (e.key === "Escape") setOpen(false);
        }} onBlur={() => setTimeout(() => setOpen(false), 150)} onFocus={() => hits.length && setOpen(true)} />
      {open && hits.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-80 w-full overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.kind}${h.id}`} role="option" aria-selected={i === active} onMouseDown={() => go(h)}
              className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-brand-50" : ""}`}>
              <div className="text-[13px]">{h.label}</div>
              <div className="meta">{h.sub}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
