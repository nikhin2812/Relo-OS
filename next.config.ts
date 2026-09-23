import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// On Vercel, stop the build if a required setting is missing, instead of going live with a
// site that fails on every page. (Values are read at build time, so add them before deploying.)
if (process.env.VERCEL) {
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_APP_URL"].filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(`Missing Vercel environment variables: ${missing.join(", ")}. See DEPLOY.md.`);
  }
}

// Browser protections sent with every page. The content security policy is only
// applied to production builds (the dev server needs eval for hot reload).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            // Next.js inlines small bootstrap scripts and styles.
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            `connect-src 'self' ${supabaseUrl}`,
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "object-src 'none'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    // Document uploads go through a server action. Files are capped at 4 MB
    // (Vercel limits request bodies to ~4.5 MB); leave room for form overhead.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
