"use client";
import { useActionState } from "react";
import { signIn } from "./actions";

export function LoginForm({ local }: { local: boolean }) {
  const [state, action, pending] = useActionState(signIn, { error: "" });
  return (
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
  );
}
