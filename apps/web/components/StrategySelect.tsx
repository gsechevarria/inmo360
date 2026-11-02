"use client";
import { useTransition } from "react";
import { STRATEGIES } from "@/lib/domain";
import { setStrategy } from "@/app/(app)/actions";

export function StrategySelect({ value }: { value: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-1.5 text-[12px] text-ink-2">
      <span className="hidden sm:inline">Estrategia</span>
      <select aria-label="Estrategia activa" className="input w-auto py-1" defaultValue={value} disabled={pending}
        onChange={(e) => start(() => setStrategy(e.target.value))}>
        {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </select>
    </label>
  );
}
