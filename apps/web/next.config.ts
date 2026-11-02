import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  transpilePackages: ["@inmo360/finance", "@inmo360/scoring"],
  serverExternalPackages: ["postgres"],
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    // La web no carga imágenes de portales ni de terceros: img-src limitado a self/data/blob.
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} ${process.env.NEXT_PUBLIC_BASEMAP_ORIGIN ?? ""}`.trim(),
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // El acceso con Google redirige a Supabase Auth y a Google tras enviar el formulario
      `form-action 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://accounts.google.com`.trim(),
    ].join("; ");
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};

export default nextConfig;
