"use client";
import { useState, useTransition } from "react";
import { deleteSavedSearch, deleteZoneSelection } from "../actions";

/** Borrado en dos pasos (sin diálogos modales del navegador). */
function ConfirmDelete({ onConfirm, what }: { onConfirm: () => Promise<unknown>; what: string }) {
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  if (!ask) return <button className="btn-ghost text-neg" onClick={() => setAsk(true)} aria-label={`Eliminar ${what}`}>Eliminar</button>;
  return (
    <span className="inline-flex items-center gap-1">
      <button className="btn text-neg" disabled={pending} onClick={() => start(async () => { await onConfirm(); })}>Confirmar</button>
      <button className="btn-ghost" onClick={() => setAsk(false)}>Cancelar</button>
    </span>
  );
}
export const DeleteSearchButton = ({ id }: { id: string }) => <ConfirmDelete what="búsqueda" onConfirm={() => deleteSavedSearch(id)} />;
export const DeleteSelectionButton = ({ id }: { id: string }) => <ConfirmDelete what="selección" onConfirm={() => deleteZoneSelection(id)} />;
