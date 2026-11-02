// Flujo de acceso con Supabase Auth simulado (supabase-auth-mock.mjs). Ver docs/PRUEBAS.md.
import { chromium } from "playwright";
const B = "http://localhost:3200";
const alerta = (page, t) => page.locator("p[role=alert]").filter({ hasText: t });
const browser = await chromium.launch();
const out = [];
const check = (name, cond, extra = "") => out.push(`${cond ? "OK " : "FALLO"} ${name} ${extra}`);
async function pedir(page, email) {
  await page.goto(B + "/login");
  await page.fill("#email", email);
  await page.click("button:has-text('Entrar')");
}
let ctx = await browser.newContext(); let page = await ctx.newPage();
await pedir(page, "limite@prueba.es");
check("límite de correos", await alerta(page, "límite de correos").waitFor({ timeout: 8000 }).then(() => true, () => false));
await pedir(page, "noexiste@prueba.es");
check("correo no autorizado", await alerta(page, "no está autorizado").waitFor({ timeout: 8000 }).then(() => true, () => false));
await pedir(page, "propietario@inmo360.local");
await page.waitForSelector("#token");
check("vista de código", await page.getByRole("status").filter({ hasText: "propietario@inmo360.local" }).isVisible());
await page.fill("#token", "000000"); await page.click("button:has-text('Entrar')");
check("código erróneo → mensaje y sigue en código", await alerta(page, "caducado").waitFor({ timeout: 8000 }).then(() => true, () => false) && await page.locator("#token").isVisible());
await page.click("text=Usar otro correo");
check("volver a pedir", await page.locator("#email").isVisible());
await page.fill("#email", "propietario@inmo360.local"); await page.click("button:has-text('Entrar')");
await page.waitForSelector("#token");
await page.fill("#token", "123 456"); await page.click("button:has-text('Entrar')");
await page.waitForURL("**/zonas**", { timeout: 20000 });
check("código correcto → /zonas", page.url().includes("/zonas"), page.url());
check("sesión persiste", (await (await page.goto(B + "/calculadora")).url()).includes("/calculadora"));
await ctx.close();

ctx = await browser.newContext(); page = await ctx.newPage();
await pedir(page, "ajeno@prueba.es"); await page.waitForSelector("#token");
await page.fill("#token", "999999"); await page.click("button:has-text('Entrar')");
check("cuenta sin perfil rechazada", await alerta(page, "no está autorizada").waitFor({ timeout: 8000 }).then(() => true, () => false));
check("sin sesión tras rechazo", (await (await page.goto(B + "/zonas")).url()).includes("/login"));
await ctx.close();

ctx = await browser.newContext(); page = await ctx.newPage();
await page.goto(B + "/auth/confirm?token_hash=hash-dueno&type=email");
check("enlace token_hash en navegador nuevo → /zonas", page.url().includes("/zonas"), page.url());
await ctx.close();

ctx = await browser.newContext(); page = await ctx.newPage();
await page.goto(B + "/auth/callback?code=abc");
check("callback sin verificador → explica el navegador", decodeURIComponent(page.url()).includes("navegador donde se pidió"), decodeURIComponent(page.url()).slice(0, 140));
await page.goto(B + "/auth/callback?error=access_denied&error_code=otp_expired");
check("callback con error de Supabase", decodeURIComponent(page.url()).includes("caducado"));
await page.goto(B + "/auth/confirm?token_hash=malo&type=email");
check("confirm con hash malo", decodeURIComponent(page.url()).includes("caducado"));
await page.goto(B + "/login");
check("sin botón Google sin AUTH_GOOGLE", (await page.locator("text=Continuar con Google").count()) === 0);
await browser.close();
console.log(out.join("\n"));
