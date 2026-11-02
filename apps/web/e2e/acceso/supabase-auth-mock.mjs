// Mock mínimo de Supabase Auth (GoTrue) para probar el flujo de acceso de la web sin red.
import http from "node:http";
const OWNER = "00000000-0000-4000-8000-000000000001";
const STRANGER = "00000000-0000-4000-8000-000000000099";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.sig`;
const user = (id, email) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
const session = (id, email) => ({ access_token: jwt(id), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r-" + id, user: user(id, email) });
const log = [];
const err = (res, status, code, msg) => { res.writeHead(status, { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" }); res.end(JSON.stringify({ code, error_code: code, msg })); };
http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const j = body ? JSON.parse(body) : {};
    log.push(`${req.method} ${u.pathname} ${JSON.stringify(j).slice(0, 120)}`);
    const ok = (o) => { res.writeHead(200, { "content-type": "application/json", "x-supabase-api-version": "2024-01-01" }); res.end(JSON.stringify(o)); };
    if (u.pathname === "/__log") return ok(log);
    if (u.pathname === "/auth/v1/otp") {
      if (j.email === "limite@prueba.es") return err(res, 429, "over_email_send_rate_limit", "email rate limit exceeded");
      if (j.email === "noexiste@prueba.es") return err(res, 422, "otp_disabled", "Signups not allowed for otp");
      return ok({});
    }
    if (u.pathname === "/auth/v1/verify" && req.method === "POST") {
      if (j.token_hash === "hash-dueno" || j.token === "123456") return ok(session(OWNER, j.email ?? "propietario@inmo360.local"));
      if (j.token === "999999") return ok(session(STRANGER, j.email));
      return err(res, 403, "otp_expired", "Token has expired or is invalid");
    }
    if (u.pathname === "/auth/v1/user") {
      const auth = req.headers.authorization ?? "";
      const sub = auth.startsWith("Bearer ") ? JSON.parse(Buffer.from(auth.split(".")[1], "base64url")).sub : null;
      return sub ? ok(user(sub, "x@prueba.es")) : err(res, 401, "no_authorization", "no token");
    }
    if (u.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
    if (u.pathname === "/auth/v1/token") return err(res, 400, "flow_state_not_found", "invalid flow state");
    err(res, 404, "not_found", "mock: " + u.pathname);
  });
}).listen(54999, "127.0.0.1");
