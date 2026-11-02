import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth";

// Intercambio del código del enlace mágico por una sesión (Supabase Auth).
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/zonas", req.url));
  }
  return NextResponse.redirect(new URL("/login?error=Enlace%20no%20v%C3%A1lido%20o%20caducado", req.url));
}
