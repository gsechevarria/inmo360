import { expect, test, type Page } from "@playwright/test";

// Flujos principales sobre la base AISLADA de desarrollo (datos INE reales + anuncios SINTÉTICOS de prueba).
test.describe.configure({ mode: "serial" });

let propertyId = "";
let scenarioUrl = "";

async function fillNum(page: Page, label: string, value: string) {
  const input = page.getByLabel(label, { exact: true }).first();
  await input.fill(value);
  await input.press("Enter");
}

test("provincia → municipio → viviendas del municipio", async ({ page }) => {
  await page.goto("/zonas/province/02");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Albacete");
  await page.getByRole("link", { name: "Ver municipios" }).click();
  await expect(page).toHaveURL(/\/zonas\?prov=02/);
  await page.getByRole("link", { name: "Albacete", exact: true }).first().click();
  await expect(page).toHaveURL(/\/zonas\/municipality\/02003/);
  await page.getByRole("link", { name: "Ver viviendas" }).click();
  await expect(page).toHaveURL(/\/viviendas\?muni=02003/);
  await expect(page.locator('ul[aria-label="Viviendas"] > li').first()).toBeVisible();
});

test("lista y mapa sincronizados: seleccionar en la lista abre la vista previa", async ({ page }) => {
  await page.goto("/viviendas?muni=02003&sort=price_asc");
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  const first = page.locator('ul[aria-label="Viviendas"] > li').first();
  await first.locator("button[aria-expanded]").click();
  await expect(page).toHaveURL(/sel=[0-9a-f-]{36}/);
  propertyId = new URL(page.url()).searchParams.get("sel")!;
  await expect(page.getByRole("link", { name: "Ficha completa" })).toBeVisible();
});

test("ficha → calculadora: datos pendientes, completar, guardar escenario", async ({ page }) => {
  await page.goto(`/viviendas/${propertyId}`);
  await expect(page.getByText("Características (valores canónicos)", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: "Analizar inversión" }).click();
  await expect(page).toHaveURL(/\/calculadora\?property=/);
  await expect(page.getByText(/parcial · \d+ dato\(s\) pendiente\(s\)/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /Datos pendientes/ })).toBeVisible();
  // Modalidad: alquiler de vivienda completa
  await page.getByLabel("Modalidad", { exact: true }).selectOption("rent_long");
  await fillNum(page, "Renta mensual", "650");
  await page.locator("summary").filter({ hasText: "Gastos e impuestos de adquisición" }).click();
  await fillNum(page, "Tipo de Impuesto de adquisición (ITP/IVA+AJD)", "6");
  await page.locator("summary").filter({ hasText: "Gastos de tenencia y explotación" }).click();
  await fillNum(page, "Importe de Comunidad de propietarios", "50");
  await fillNum(page, "Importe de IBI", "300");
  await fillNum(page, "Importe de Seguro de hogar", "200");
  await expect(page.getByText("completo", { exact: true })).toBeVisible();
  const tile = page.locator("div[title]").filter({ hasText: "Rentabilidad neta operativa" }).first();
  await expect(tile).toContainText("%");
  await page.getByLabel("Nombre del escenario").fill("E2E alquiler");
  await page.getByRole("button", { name: "Guardar escenario" }).click();
  await expect(page).toHaveURL(/scenario=[0-9a-f-]{36}/);
  scenarioUrl = page.url();
  await page.goto(`/viviendas/${propertyId}`);
  await expect(page.getByText("E2E alquiler").first()).toBeVisible();
});

test("precio máximo de compra con objetivo de rentabilidad", async ({ page }) => {
  await page.goto(scenarioUrl);
  await page.getByRole("tab", { name: "Precio máximo de compra" }).click();
  await fillNum(page, "Rentabilidad neta operativa mínima", "4");
  await page.getByRole("button", { name: "Calcular precio máximo" }).click();
  await expect(page.getByText("Precio máximo compatible")).toBeVisible();
  await expect(page.getByText(/^Calculado$|Límite de búsqueda alcanzado/)).toBeVisible();
  await page.getByRole("button", { name: "Guardar resultado en el escenario" }).click();
  await expect(page.getByText(/recalculado en servidor y guardado/)).toBeVisible();
});

test("comparar escenarios guardados y viviendas con los mismos supuestos", async ({ page }) => {
  const sid = new URL(scenarioUrl).searchParams.get("scenario")!;
  await page.goto(`/comparar?modo=escenarios&escenarios=${sid}`);
  await expect(page.getByRole("link", { name: "E2E alquiler" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Rentabilidad neta operativa/ })).toBeVisible();
  await page.goto(`/viviendas?muni=02003&sort=price_desc`);
  await page.locator('ul[aria-label="Viviendas"] > li').first().locator("button[aria-expanded]").click();
  await expect(page).toHaveURL(/sel=/);
  const other = new URL(page.url()).searchParams.get("sel")!;
  await page.goto(`/comparar?modo=viviendas&viviendas=${propertyId},${other}&itp=6&com=50&ibi=300&seg=200`);
  await expect(page.locator("thead th")).toHaveCount(3);
  await expect(page.getByRole("row", { name: /Precio publicado/ })).toBeVisible();
});

test("corrección de un dato y seguimiento como oportunidad", async ({ page }) => {
  await page.goto(`/viviendas/${propertyId}`);
  await page.getByRole("button", { name: "Corregir Superficie construida (m²)" }).click();
  await page.getByLabel("Nuevo valor de Superficie construida (m²)").fill("55");
  await page.getByLabel("Motivo de la corrección").fill("medido en la visita (E2E)");
  const row = page.getByRole("row", { name: /Superficie construida/ });
  await row.getByRole("button", { name: "Guardar", exact: true }).click();
  await expect(row).toContainText("corrección del usuario");
  await expect(row).toContainText("55");
  await page.getByLabel("Estado de seguimiento").selectOption("to_analyze");
  await expect(page.getByText(/Guardado · el estado es tuyo/)).toBeVisible();
  await page.goto("/oportunidades?estado=to_analyze");
  await expect(page.locator(`a[href="/viviendas/${propertyId}"]`).first()).toBeVisible();
});

test("importación con el trabajador apagado: queda pendiente y se puede cancelar", async ({ page }) => {
  await page.goto("/importaciones");
  await expect(page.getByText(/Ningún trabajador conectado/)).toBeVisible();
  await page.getByLabel("Tipo de trabajo").selectOption("stats.derive");
  await page.getByRole("button", { name: "Encolar trabajo" }).click();
  await expect(page.getByText(/encolado como PENDIENTE/)).toBeVisible();
  await page.reload();
  const row = page.getByRole("row").filter({ hasText: "stats.derive" }).filter({ hasText: "Pendiente" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText("Cancelado.").first()).toBeVisible();
});

test("datos incompletos: escenario turístico sin hipótesis no muestra ceros", async ({ page }) => {
  await page.goto("/calculadora?strategy=tourist");
  await expect(page.getByText(/parcial · \d+ dato\(s\) pendiente\(s\)/)).toBeVisible();
  const tile = page.locator("div[title]").filter({ hasText: "Rentabilidad neta operativa" }).first();
  await expect(tile).toContainText("No calculable");
  await expect(tile).not.toContainText("0,00 %");
});

test("la web no carga fotos ni recursos de terceros", async ({ page }) => {
  const external: string[] = [], images: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["127.0.0.1", "localhost"].includes(u.hostname) && !["data:", "blob:"].includes(u.protocol)) external.push(r.url());
    if (r.resourceType() === "image" && !u.pathname.startsWith("/_next/") && u.protocol !== "data:") images.push(r.url());
  });
  await page.goto("/viviendas?muni=02003");
  await page.locator('ul[aria-label="Viviendas"] > li').first().locator("button[aria-expanded]").click();
  await page.goto(`/viviendas/${propertyId}`);
  await page.waitForLoadState("networkidle");
  expect(external, `peticiones externas: ${external.join(", ")}`).toEqual([]);
  expect(images.filter((x) => !/favicon|icon/.test(x))).toEqual([]);
});

test("sin sesión no hay acceso a datos", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const p = await ctx.newPage();
  await p.goto("/viviendas");
  await expect(p).toHaveURL(/\/login/);
  const r = await p.request.get("/api/tiles/municipality/4/7/5?ind=pop.padron", { maxRedirects: 0 });
  expect([401, 403, 307, 302]).toContain(r.status());
  await ctx.close();
});
