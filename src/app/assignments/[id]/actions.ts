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
