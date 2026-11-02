"use client";
import { useActionState } from "react";
import { signIn, signInWithGoogle } from "./actions";

export function LoginForm({ local }: { local: boolean }) {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
    <div className="space-y-4">
    {!local && (
      <form action={signInWithGoogle}>
        <button className="btn w-full justify-center py-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-7.9z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>
          Continuar con Google
        </button>
      </form>
    )}
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="email">Correo electrónico</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" defaultValue={local ? "propietario@inmo360.local" : ""} />
      </div>
      {!local && (
        <div>
          <label className="label" htmlFor="password">Contraseña <span className="meta">(o déjela vacía para recibir un enlace)</span></label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" />
        </div>
      )}
      {state.error && <p role="alert" className="text-[13px] text-neg">{state.error}</p>}
      <button className="btn-primary w-full justify-center py-2" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
    </div>
  );
}
