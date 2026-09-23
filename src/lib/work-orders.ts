import { createHash, randomBytes } from "node:crypto";

// Work order links. The token is random (256 bits); only its SHA-256 hash is
// stored, so a copy of the database can't be used to open anyone's portal.

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

// Must match private.token_hash() in the database.
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function portalUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/portal/${encodeURIComponent(token)}`;
}

export const WORK_ORDER_STATUSES = ["sent", "accepted", "declined", "booked", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

// Live orders count as committed spend; declined/cancelled ones don't.
export function isLiveWorkOrder(status: string | null | undefined): boolean {
  return status === "sent" || status === "accepted" || status === "booked" || status === "completed";
}

export const STAFF_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  sent: "Work order sent",
  accepted: "Accepted by provider",
  declined: "Declined by provider",
  booked: "Booked",
  completed: "Completed",
  cancelled: "Cancelled",
};

// What the employee sees on their journey — no provider commercial detail.
export const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  planned: "Being arranged",
  sent: "Being arranged",
  accepted: "Confirmed by provider",
  declined: "Being arranged",
  booked: "Booked",
  completed: "Done",
  cancelled: "Being arranged",
};

export type PortalAction = "accept" | "decline" | "book" | "complete";

// Which buttons the provider sees for each status. Mirrors portal_update_work_order().
export function allowedPortalActions(status: string): PortalAction[] {
  switch (status) {
    case "sent":
      return ["accept", "book", "decline"];
    case "accepted":
      return ["book", "decline"];
    case "booked":
      return ["complete"];
    default:
      return [];
  }
}
