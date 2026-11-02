"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOCAL_COOKIE, localAuthAllowed, makeLocalSession, supabaseServer } from "@/lib/auth";
import { authErrorText } from "@/lib/authErrors";
import { withUser, sql } from "@/lib/db";

export interface LoginState { error: string; sent?: string }

/** Autenticado en Supabase pero sin perfil en app.user_profiles → no autorizado: se cierra la sesión. */
async function authorizedOrSignOut(sb: Awaited<ReturnType<typeof supabaseServer>>, userId: string): Promise<boolean> {
  const prof = await withUser(userId, (tx) => tx`select 1 from app.user_profiles where user_id = ${userId}`);
  if (prof.length) return true;
  await sb.auth.signOut();
  return false;
}

const NOT_AUTHORIZED = "Esta cuenta no está autorizada en Inmo360.";

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: "Correo no válido." };
  if (process.env.AUTH_MODE === "local") {
    if (!localAuthAllowed()) return { error: "El modo local está desactivado en este entorno." };
    // Solo en la base aislada: el usuario debe existir y tener perfil autorizado.
    // app.dev_local_user solo existe en la base aislada (scripts/local/dev-owner.sql)
    const rows = await sql()`select app.dev_local_user(${email}) as id`.catch(() => [] as { id: string | null }[]);
    if (!rows[0]?.id) return { error: "Usuario no autorizado." };
    (await cookies()).set(LOCAL_COOKIE, makeLocalSession(rows[0].id), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
    redirect("/zonas");
  }
  const sb = await supabaseServer();
  const password = String(form.get("password") ?? "");
  if (password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { error: authErrorText(error) };
    if (!(await authorizedOrSignOut(sb, data.user.id))) return { error: NOT_AUTHORIZED };
    redirect("/zonas");
  }
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  // shouldCreateUser:false → sin registro público aunque alguien conozca la URL
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
  if (error) return { error: authErrorText(error) };
  return { error: "", sent: email };
}

/** Código de un solo uso del correo ({{ .Token }}): funciona en cualquier navegador o dispositivo. */
export async function verifyCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("token") ?? "").replace(/\s+/g, "");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return { error: "Correo no válido." };
  if (!/^\d{6,10}$/.test(token)) return { error: "El código son las cifras que aparecen en el correo.", sent: email };
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.user) return { error: authErrorText(error), sent: email };
  if (!(await authorizedOrSignOut(sb, data.user.id))) return { error: NOT_AUTHORIZED };
  redirect("/zonas");
}

/** Acceso con Google (OAuth PKCE de Supabase). La cuenta debe existir ya en Supabase Auth: sin registro público. */
export async function signInWithGoogle() {
  if (process.env.AUTH_MODE === "local") redirect("/login?error=No%20disponible%20en%20modo%20local");
  if (process.env.AUTH_GOOGLE !== "1") redirect("/login?error=Acceso%20con%20Google%20no%20configurado");
  const sb = await supabaseServer();
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { data, error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) redirect("/login?error=No%20se%20pudo%20iniciar%20el%20acceso%20con%20Google");
  redirect(data.url);
}

export async function signOut() {
  if (process.env.AUTH_MODE === "local") (await cookies()).delete(LOCAL_COOKIE);
  else await (await supabaseServer()).auth.signOut();
  redirect("/login");
}
