import "server-only";

import { headers } from "next/headers";

// The public address of the app, for links in emails. On Vercel this must come
// from NEXT_PUBLIC_APP_URL: a link built from request headers could be steered
// to another site by a tampered request.
export async function appBaseUrl(): Promise<string> {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL) throw new Error("Set NEXT_PUBLIC_APP_URL to the site's public address");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
