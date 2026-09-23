// Login cookies: not readable by page scripts (the app only uses Supabase on the
// server), sent over HTTPS only in production, and not sent on cross-site posts.
export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" && !process.env.PLAYWRIGHT_HTTP,
  sameSite: "lax" as const,
  path: "/",
};
