import "server-only";

import { createClient } from "@supabase/supabase-js";

import { supabaseEnv } from "@/lib/env";

// A client with no user session, for the account-free provider portal. It can
// only do what the anon role is granted: the portal_* functions and portal uploads.
export function createAnonClient() {
  const { url, anonKey } = supabaseEnv();
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
}
