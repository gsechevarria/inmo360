import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/auth";
import { withUser } from "@/lib/db";

// Intercambio del código (enlace mágico u OAuth de Google) por una sesión de Supabase Auth.
// Una cuenta autenticada pero sin perfil en app.user_profiles no está autorizada: se cierra su sesión.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      const prof = await withUser(data.user.id, (tx) => tx`select 1 from app.user_profiles where user_id = ${data.user!.id}`);
      if (prof.length) return NextResponse.redirect(new URL("/zonas", req.url));
      await sb.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=Esta%20cuenta%20no%20est%C3%A1%20autorizada%20en%20Inmo360", req.url));
    }
  }
  return NextResponse.redirect(new URL("/login?error=Enlace%20no%20v%C3%A1lido%20o%20caducado", req.url));
}
