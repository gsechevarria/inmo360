import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refresca la sesión de Supabase Auth (cookies) en cada navegación. La autorización real se comprueba en el
 * servidor (requireUser) y en la base (RLS); esto es solo la renovación optimista del token.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  if (process.env.AUTH_MODE === "local" || !process.env.NEXT_PUBLIC_SUPABASE_URL) return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|woff2?)$).*)"] };
