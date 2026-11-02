"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOCAL_COOKIE, localAuthAllowed, makeLocalSession, supabaseServer } from "@/lib/auth";
import { sql } from "@/lib/db";

export async function signIn(_prev: { error: string }, form: FormData): Promise<{ error: string }> {
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
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { error: "Credenciales no válidas." };
    redirect("/zonas");
  }
  const origin = (await headers()).get("origin") ?? "";
  // shouldCreateUser:false → sin registro público aunque alguien conozca la URL
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` } });
  if (error) return { error: "No se pudo enviar el enlace (¿usuario no invitado?)." };
  redirect("/login?sent=1");
}

/** Acceso con Google (OAuth PKCE de Supabase). La cuenta debe existir ya en Supabase Auth: sin registro público. */
export async function signInWithGoogle() {
  if (process.env.AUTH_MODE === "local") redirect("/login?error=No%20disponible%20en%20modo%20local");
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
