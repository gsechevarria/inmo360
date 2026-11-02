/**
 * Mensajes de acceso comprensibles a partir de los códigos de Supabase Auth. Nunca incluye datos del usuario ni
 * secretos; ante un código desconocido muestra el código para poder diagnosticarlo.
 */
export function authErrorText(e: { code?: string | null; name?: string | null; status?: number | null } | null | undefined): string {
  const code = e?.code ?? (e?.name === "AuthPKCECodeVerifierMissingError" ? "pkce_code_verifier_not_found" : null);
  switch (code) {
    case "over_email_send_rate_limit":
      return "Supabase ha alcanzado su límite de correos por hora (el SMTP integrado permite muy pocos). Espere y vuelva a pedirlo, o configure un SMTP propio en Supabase.";
    case "email_address_not_authorized":
      return "El SMTP integrado de Supabase no envía a este correo (solo a miembros del equipo del proyecto). Configure un SMTP propio en Supabase.";
    case "otp_disabled":
    case "signup_disabled":
    case "user_not_found":
      return "Este correo no está autorizado en Inmo360.";
    case "over_request_rate_limit":
      return "Demasiados intentos seguidos. Espere unos minutos.";
    case "otp_expired":
      return "El código o el enlace ha caducado o ya se usó. Pida uno nuevo y use el último que reciba.";
    case "pkce_code_verifier_not_found":
    case "bad_code_verifier":
    case "flow_state_not_found":
    case "flow_state_expired":
      return "Este enlace solo sirve en el navegador donde se pidió. Use el código de 6 cifras del correo o pida un enlace nuevo desde este navegador.";
    case "invalid_credentials":
      return "Credenciales no válidas.";
    case "email_not_confirmed":
      return "El correo no está confirmado. Entre con el código o el enlace del correo.";
    case "email_address_invalid":
      return "Correo no válido.";
    default:
      return `No se pudo completar el acceso (${code ?? e?.status ?? "error desconocido"}).`;
  }
}

/** Códigos de error que Supabase añade a la URL de retorno (p. ej. ?error_code=otp_expired). */
export function authErrorFromParams(p: URLSearchParams): string | null {
  const code = p.get("error_code");
  if (code) return authErrorText({ code });
  return p.get("error") ? authErrorText({ code: p.get("error") }) : null;
}
