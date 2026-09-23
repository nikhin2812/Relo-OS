import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";

import { TEST_ADMIN_EMAIL, demoPassword } from "../demo-users";

// Empties the test-only RMC. Runs once before and once after the whole
// Playwright run, so test files running in parallel never wipe each other.
export default async function clearTestRmc() {
  Object.assign(process.env, loadEnv("test", process.cwd(), ""));
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email: TEST_ADMIN_EMAIL, password: demoPassword() });
  if (signInError) throw signInError;
  const { error } = await client.rpc("reset_test_tenant_data");
  if (error) throw error;
}
