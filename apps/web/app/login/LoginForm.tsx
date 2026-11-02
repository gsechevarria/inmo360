"use client";
import { useActionState, useState } from "react";
import { signIn, signInWithGoogle, verifyCode, type LoginState } from "./actions";

const EMPTY: LoginState = { error: "" };

export function LoginForm({ local, google }: { local: boolean; google: boolean }) {
  const [state, action, pending] = useActionState(signIn, EMPTY);
  const [codeState, codeAction, codePending] = useActionState(verifyCode, EMPTY);
  // «Usar otro correo» descarta los estados actuales; cada envío crea un estado nuevo que vuelve a mostrarse
  const [dismissed, setDismissed] = useState<LoginState[]>([]);
  const live = (s: LoginState) => !dismissed.includes(s);
  const sentTo = codeState.sent && live(codeState) ? codeState.sent : state.sent && live(state) ? state.sent : null;

  if (sentTo) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-md bg-pos-50 px-3 py-2 text-[13px] text-pos">
          Le hemos enviado un correo a <strong>{sentTo}</strong>. Escriba el código o pulse el enlace del correo.
        </p>
        <form action={codeAction} className="space-y-3">
          <input type="hidden" name="email" value={sentTo} />
          <div>
            <label className="label" htmlFor="token">Código del correo</label>
            <input id="token" name="token" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" required
              className="input tracking-[0.3em] text-center text-lg" autoFocus />
          </div>
          {codeState.error && live(codeState) && <p role="alert" className="text-[13px] text-neg">{codeState.error}</p>}
          <button className="btn-primary w-full justify-center py-2" disabled={codePending}>{codePending ? "Comprobando…" : "Entrar"}</button>
        </form>
        <button type="button" className="btn w-full justify-center" onClick={() => setDismissed((d) => [...d, state, codeState])}>Usar otro correo o pedir otro código</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
    {!local && google && (
      <form action={signInWithGoogle}>
        <button className="btn w-full justify-center py-2">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4"><path fill="#4285F4" d="M22.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-7.9z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1-3.7 1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.1a11 11 0 0 0 0 9.8l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>
          Continuar con Google
        </button>
      </form>
    )}
    <form action={action} className="space-y-3" key={dismissed.length}>
      <div>
        <label className="label" htmlFor="email">Correo electrónico</label>
        <input id="email" name="email" type="email" required autoComplete="email" className="input" defaultValue={local ? "propietario@inmo360.local" : ""} />
      </div>
      {!local && (
        <div>
          <label className="label" htmlFor="password">Contraseña <span className="meta">(o déjela vacía para recibir un código)</span></label>
          <input id="password" name="password" type="password" autoComplete="current-password" className="input" />
        </div>
      )}
      {state.error && live(state) && <p role="alert" className="text-[13px] text-neg">{state.error}</p>}
      <button className="btn-primary w-full justify-center py-2" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button>
    </form>
    </div>
  );
}
