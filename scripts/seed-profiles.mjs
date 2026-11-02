// Genera supabase/seed/020_scoring_profiles.sql a partir de packages/scoring/src/profiles.ts (perfiles EXPERIMENTALES del sistema).
import { writeFileSync } from "node:fs";
import { EXPERIMENTAL_PROFILES } from "../packages/scoring/src/profiles.ts";
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lines = ["-- GENERADO por scripts/seed-profiles.mjs — perfiles experimentales (no validados). Idempotente.", "begin;"];
for (const p of EXPERIMENTAL_PROFILES) {
  const id = `(select id from scoring.profiles where owner_id is null and name = ${q(p.name)})`;
  lines.push(`insert into scoring.profiles(owner_id, name, strategy, block, description, is_experimental)
  select null, ${q(p.name)}, ${q(p.strategy)}, ${q(p.block)}, ${q(p.description)}, true
  where not exists (select 1 from scoring.profiles where owner_id is null and name = ${q(p.name)});`);
  lines.push(`insert into scoring.profile_versions(profile_id, version, config, valid_from, notes)
  values (${id}, ${p.version}, ${q(JSON.stringify(p))}::jsonb, ${q(p.validFrom)}, 'Versión inicial propuesta (experimental)')
  on conflict (profile_id, version) do update set config = excluded.config;`);
}
lines.push("commit;");
writeFileSync(new URL("../supabase/seed/020_scoring_profiles.sql", import.meta.url), lines.join("\n") + "\n");
console.log(`ok: ${EXPERIMENTAL_PROFILES.length} perfiles`);
