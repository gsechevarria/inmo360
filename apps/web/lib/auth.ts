import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { withUser } from "./db";

export interface SessionUser { id: string; email: string | null; role: "owner" | "member" }

const LOCAL_COOKIE = "inmo_local_session";

/** El modo local solo existe para la base AISLADA de desarrollo: se niega en Vercel o con BD remota. */
export function localAuthAllowed(): boolean {
  if (process.env.AUTH_MODE !== "local") return false;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;
  const url = process.env.DATABASE_URL ?? "";
  const host = url.replace(/^.*@/, "").split(/[:/]/)[0];
  const secret = process.env.LOCAL_AUTH_SECRET ?? "";
  return (host === "127.0.0.1" || host === "localhost") && secret.length >= 32;
}

function sign(v: string): string {
  return createHmac("sha256", process.env.LOCAL_AUTH_SECRET!).update(v).digest("base64url");
}

export function makeLocalSession(userId: string): string {
  const exp = Date.now() + 12 * 3600_000;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

function readLocalSession(v: string | undefined): string | null {
  if (!v || !localAuthAllowed()) return null;
  const [id, exp, sig] = v.split(".");
  if (!id || !exp || !sig) return null;
  const good = Buffer.from(sign(`${id}.${exp}`));
  const got = Buffer.from(sig);
  if (good.length !== got.length || !timingSafeEqual(good, got) || Number(exp) < Date.now()) return null;
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* RSC: solo lectura */ } },
    },
  });
}

/** Usuario autenticado Y autorizado (perfil en app.user_profiles). null si no hay sesión válida. */
export async function getUser(): Promise<SessionUser | null> {
  let id: string | null = null;
  let email: string | null = null;
  if (process.env.AUTH_MODE === "local") {
    id = readLocalSession((await cookies()).get(LOCAL_COOKIE)?.value);
  } else {
    const sb = await supabaseServer();
    const { data } = await sb.auth.getUser();       // verifica el token con Supabase Auth (no solo la cookie)
    id = data.user?.id ?? null;
    email = data.user?.email ?? null;
  }
  if (!id) return null;
  const prof = await withUser(id, async (tx) => tx<{ role: "owner" | "member" }[]>`select role from app.user_profiles where user_id = ${id}`);
  if (!prof[0]) return null;                         // autenticado pero no autorizado: sin registro público
  return { id, email, role: prof[0].role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireOwner(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== "owner") throw new Error("Solo el propietario puede realizar esta acción");
  return u;
}

export { LOCAL_COOKIE };
