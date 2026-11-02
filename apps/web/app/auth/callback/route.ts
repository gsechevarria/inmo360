import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth";
import { authErrorFromParams, authErrorText } from "@/lib/authErrors";
import { withUser } from "@/lib/db";

// Intercambio del código (enlace mágico por defecto de Supabase u OAuth de Google) por una sesión.
// Requiere el verificador PKCE guardado en este navegador; para enlaces que funcionen en cualquier navegador,
// la plantilla de correo apunta a /auth/confirm (token_hash). Ver docs/SUPABASE.md §4.
// Una cuenta autenticada pero sin perfil en app.user_profiles no está autorizada: se cierra su sesión.
function toLogin(req: NextRequest, msg: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
}

export async function GET(req: NextRequest) {
  const fromSupabase = authErrorFromParams(req.nextUrl.searchParams);
  if (fromSupabase) return toLogin(req, fromSupabase);
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return toLogin(req, "Enlace no válido o incompleto. Pida uno nuevo.");
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error || !data.user) return toLogin(req, authErrorText(error));
  const prof = await withUser(data.user.id, (tx) => tx`select 1 from app.user_profiles where user_id = ${data.user!.id}`);
  if (prof.length) return NextResponse.redirect(new URL("/zonas", req.url));
  await sb.auth.signOut();
  return toLogin(req, "Esta cuenta no está autorizada en Inmo360.");
}
