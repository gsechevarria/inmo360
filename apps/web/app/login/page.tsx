import { redirect } from "next/navigation";
import { getUser, localAuthAllowed } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Acceso" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  if (await getUser()) redirect("/zonas");
  const sp = await searchParams;
  const local = localAuthAllowed();
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="panel w-full max-w-sm p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="grid place-items-center h-8 w-8 rounded-md bg-brand text-white font-bold">i</span>
          <h1 className="text-xl font-semibold">Inmo360</h1>
        </div>
        <p className="meta mb-5">Acceso privado. No hay registro público: solo usuarios autorizados por el propietario.</p>
        {sp.error && <p role="alert" className="mb-3 rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg">{sp.error}</p>}
        {sp.sent && <p role="status" className="mb-3 rounded-md bg-pos-50 px-3 py-2 text-[13px] text-pos">Revise su correo: le hemos enviado un enlace de acceso.</p>}
        <LoginForm local={local} />
        {local && <p className="meta mt-4 border-t border-line pt-3">Modo local de desarrollo (base aislada). No disponible en Vercel ni con bases remotas.</p>}
      </div>
    </main>
  );
}
