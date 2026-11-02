import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/auth";
import { authErrorFromParams, authErrorText } from "@/lib/authErrors";
import { withUser } from "@/lib/db";

// Enlace del correo con token_hash (plantilla «Magic Link» de Supabase, ver docs/SUPABASE.md §4):
// se verifica en el servidor, sin verificador PKCE, así que funciona aunque se abra en otro navegador o en el móvil.
const TYPES: EmailOtpType[] = ["email", "magiclink", "invite", "recovery", "signup", "email_change"];

function toLogin(req: NextRequest, msg: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const fromSupabase = authErrorFromParams(p);
  if (fromSupabase) return toLogin(req, fromSupabase);
  const token_hash = p.get("token_hash");
  const type = (p.get("type") ?? "email") as EmailOtpType;
  if (!token_hash || !TYPES.includes(type)) return toLogin(req, "Enlace no válido o incompleto. Pida uno nuevo.");
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.verifyOtp({ token_hash, type });
  if (error || !data.user) return toLogin(req, authErrorText(error));
  const prof = await withUser(data.user.id, (tx) => tx`select 1 from app.user_profiles where user_id = ${data.user!.id}`);
  if (prof.length) return NextResponse.redirect(new URL("/zonas", req.url));
  await sb.auth.signOut();
  return toLogin(req, "Esta cuenta no está autorizada en Inmo360.");
}
