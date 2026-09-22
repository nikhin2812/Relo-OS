import { redirect } from "next/navigation";

import { isRole, type Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  tenantName: string;
};

// Returns the logged-in user's profile, or sends them to /login.
export async function requireUser(): Promise<CurrentUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, rmc_tenants(name)")
    .eq("id", user.id)
    .single();

  // A login with no profile (or an unknown role) gets no access at all.
  if (!profile || !isRole(profile.role)) redirect("/login?error=no-profile");

  const tenant = profile.rmc_tenants as unknown as { name: string } | null;
  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    role: profile.role,
    tenantName: tenant?.name ?? "",
  };
}
