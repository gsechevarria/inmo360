// Genera JSON Schema de los contratos para el trabajador (Python). Uso: npm run schemas -w @inmo360/contracts
import { writeFileSync } from "node:fs";
import { z } from "zod";
import { SCHEMAS } from "../src/index.ts";

for (const [name, schema] of Object.entries(SCHEMAS)) {
  const js = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  writeFileSync(new URL(`../generated/${name}.schema.json`, import.meta.url), JSON.stringify(js, null, 2) + "\n");
  console.log("ok", name);
}
