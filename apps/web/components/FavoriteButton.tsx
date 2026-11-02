"use client";
import { useOptimistic, useTransition } from "react";
import { toggleFavorite } from "@/app/(app)/actions";
import { IconStar } from "./icons";

export function FavoriteButton({ targetType, targetId, active }: { targetType: "property" | "listing" | "geography"; targetId: string; active: boolean }) {
  const [on, setOn] = useOptimistic(active);
  const [pending, start] = useTransition();
  return (
    <button className={`btn ${on ? "border-focus bg-warn-50 text-warn" : ""}`} aria-pressed={on} disabled={pending}
      onClick={() => start(async () => { setOn(!on); await toggleFavorite(targetType, targetId); })}>
      <IconStar /> {on ? "Guardado" : "Guardar"}
    </button>
  );
}
