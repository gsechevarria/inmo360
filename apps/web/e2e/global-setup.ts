import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";

/** Inicia sesión una vez (modo local de desarrollo) y guarda la sesión para todas las pruebas. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  mkdirSync("e2e/.auth", { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto(`${baseURL}/login`, { timeout: 180_000 });
  await p.fill("#email", process.env.E2E_EMAIL ?? "propietario@inmo360.local");
  await Promise.all([p.waitForURL(/\/zonas/, { timeout: 120_000 }), p.click("button:has-text('Entrar')")]);
  await p.context().storageState({ path: "e2e/.auth/owner.json" });
  await b.close();
}
