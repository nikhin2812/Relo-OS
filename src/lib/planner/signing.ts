import "server-only";

import { createHmac } from "node:crypto";

// Plans are saved with a signature only the server can make (PLAN_SIGNING_SECRET, which
// the database also holds). This stops anyone saving a hand-written plan through the API.
// Must match private.plan_signature_ok in supabase/migrations/20260925000001_plan_signing.sql.

export function planSigningSecret(): string | null {
  const secret = process.env.PLAN_SIGNING_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function signPlan(secret: string, assignmentId: string, planText: string, model: string, signedAt = Date.now()) {
  const message = `${assignmentId.toLowerCase()}.${signedAt}.${model}.${planText}`;
  return { signedAt, signature: createHmac("sha256", secret).update(message, "utf8").digest("hex") };
}
