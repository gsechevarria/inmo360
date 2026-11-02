import "server-only";
import { scoreSubject, type FactorInput, type ProfileConfig, type ScoreResult } from "@inmo360/scoring";
import { num, type Tx } from "./db";
import { universeValues } from "./queries/zone-detail";

/** Perfil ACTIVO del usuario para un bloque y estrategia (null → «pendiente de configuración»). */
export async function activeProfile(tx: Tx, userId: string, block: "zone" | "property" | "operation", strategy: string) {
  const pref = await tx`select active_profile_versions as a from app.preferences where user_id = ${userId}`;
  const map = (pref[0]?.a ?? {}) as Record<string, string>;
  const vid = map[`${block}:${strategy}`] ?? map[`${block}:any`];
  if (!vid) return null;
  const r = await tx`select v.id, v.version, v.config from scoring.profile_versions v where v.id = ${vid}`;
  return r[0] ? { versionId: r[0].id as string, config: r[0].config as ProfileConfig } : null;
}

const universeCache = new Map<string, { at: number; v: number[] }>();

export async function zoneScore(tx: Tx, geoId: number, profile: { versionId: string; config: ProfileConfig } | null): Promise<ScoreResult> {
  if (!profile) return scoreSubject(null, {});
  const p = profile.config;
  const codes = p.factors.filter((f) => f.source === "indicator").map((f) => f.key);
  const vals = await tx`select indicator_code, value_num, period, resource_code from stats.latest_values
                         where geography_id = ${geoId} and dims_key = '' and indicator_code = any(${codes})`;
  const inputs: Record<string, FactorInput> = {};
  const universes: Record<string, number[]> = {};
  for (const f of p.factors) {
    const v = vals.find((x) => x.indicator_code === f.key);
    inputs[f.id] = { value: v ? num(v.value_num) : null, period: v?.period, source: v?.resource_code };
    if (f.transform === "percentile") {
      const key = `${f.key}:${p.universe?.minPopulation ?? 0}`;
      const c = universeCache.get(key);
      if (c && Date.now() - c.at < 10 * 60_000) universes[f.id] = c.v;
      else {
        const u = await universeValues(tx, f.key, p.universe?.minPopulation ?? 0);
        universeCache.set(key, { at: Date.now(), v: u });
        universes[f.id] = u;
      }
    }
  }
  return scoreSubject(p, inputs, universes);
}
