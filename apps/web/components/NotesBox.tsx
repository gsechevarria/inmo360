"use client";
import { useState, useTransition } from "react";
import { addNote, deleteNote } from "@/app/(app)/actions";
import { dateEs } from "@/lib/format";

export function NotesBox({ targetType, targetId, notes, path }: { targetType: string; targetId: string; notes: { id: string; body: string; created_at: string }[]; path: string }) {
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="p-3">
      <form onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await addNote(targetType, targetId, body, path); if (r.ok) setBody(""); else setErr(r.error); }); }}>
        <label htmlFor={`note-${targetId}`} className="sr-only">Nueva nota</label>
        <textarea id={`note-${targetId}`} className="input min-h-[64px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Añadir una nota privada…" />
        <button className="btn mt-1" disabled={pending || !body.trim()}>Guardar nota</button>
        {err && <p role="alert" className="meta text-neg">{err}</p>}
      </form>
      <ul className="mt-2 space-y-2">
        {notes.map((x) => (
          <li key={x.id} className="rounded-md bg-canvas p-2 text-[13px]">
            <div className="whitespace-pre-wrap">{x.body}</div>
            <div className="meta mt-1 flex justify-between">{dateEs(x.created_at, true)}
              <button className="hover:text-neg" onClick={() => start(async () => { await deleteNote(x.id, path); })}>Eliminar</button></div>
          </li>
        ))}
      </ul>
    </div>
  );
}
