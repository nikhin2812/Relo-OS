"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { canSeeBudgets } from "@/lib/roles";
import { generatePlan } from "@/lib/planner/generate";
import { createClient } from "@/lib/supabase/server";

export type GenerateState = { error?: string } | undefined;

export async function generatePlanAction(_prev: GenerateState, formData: FormData): Promise<GenerateState> {
  const user = await requireUser();
  if (!canSeeBudgets(user.role)) return { error: "You can't generate plans." };

  const id = z.string().uuid().safeParse(formData.get("assignmentId"));
  if (!id.success) return { error: "Unknown relocation." };

  const supabase = await createClient();
  const result = await generatePlan(supabase, id.data);
  revalidatePath(`/assignments/${id.data}`);
  return result.ok ? undefined : { error: result.message };
}

export type ProviderState = { error?: string; saved?: boolean } | undefined;

// MVP item 5: the RMC admin or allocated consultant picks a provider for a service.
export async function selectProviderAction(_prev: ProviderState, formData: FormData): Promise<ProviderState> {
  const user = await requireUser();
  if (user.role !== "rmc_admin" && user.role !== "consultant") return { error: "You can't choose providers." };

  const ids = z
    .object({ serviceId: z.string().uuid(), vendorId: z.string().uuid("Choose a provider"), assignmentId: z.string().uuid() })
    .safeParse({
      serviceId: formData.get("serviceId"),
      vendorId: formData.get("vendorId"),
      assignmentId: formData.get("assignmentId"),
    });
  if (!ids.success) return { error: ids.error.issues[0]?.message ?? "Choose a provider" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("select_service_provider", {
    p_service_id: ids.data.serviceId,
    p_vendor_id: ids.data.vendorId,
  });
  if (error) {
    console.error("select_service_provider failed", error.code, error.message);
    return { error: error.code === "42501" ? "You can't choose providers for this relocation." : "That provider could not be saved." };
  }
  revalidatePath(`/assignments/${ids.data.assignmentId}`);
  return { saved: true };
}
