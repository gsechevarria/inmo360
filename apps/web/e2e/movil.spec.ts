import { expect, test } from "@playwright/test";

// Comprobación en móvil: sin desbordamiento horizontal y navegación utilizable.
const PAGES = ["/zonas", "/viviendas?muni=02003", "/calculadora?strategy=rent_long", "/comparar?zonas=02003,28079", "/oportunidades", "/catalogo", "/configuracion"];

for (const path of PAGES) {
  test(`móvil sin scroll horizontal: ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("navigation").first()).toBeVisible();
  });
}

test("móvil: alternar lista y mapa en el explorador de viviendas", async ({ page }) => {
  await page.goto("/viviendas?muni=02003");
  await page.getByRole("tab", { name: /mapa/i }).click();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await page.getByRole("tab", { name: /lista/i }).click();
  await expect(page.locator('ul[aria-label="Viviendas"] > li').first()).toBeVisible();
});
