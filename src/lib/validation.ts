import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  password: z.string().min(1, "Enter your password").max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// MVP item 1. The database repeats these checks; this gives HR friendly messages first.
export function relocationRequestSchema(today: string = todayIso()) {
  return z
    .object({
      employeeName: z.string().trim().min(1, "Enter the employee's name").max(200, "Name is too long"),
      familySize: z.coerce
        .number({ error: "Enter the family size" })
        .int("Family size must be a whole number")
        .min(1, "Family size must be at least 1")
        .max(20, "Family size must be 20 or fewer"),
      origin: z.string().trim().min(1, "Enter where they are moving from").max(200, "Origin is too long"),
      destination: z.string().trim().min(1, "Enter where they are moving to").max(200, "Destination is too long"),
      moveDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the move date")
        .refine((d) => d >= today, "Move date can't be in the past")
        .refine((d) => d <= addDays(today, 730), "Move date must be within the next two years"),
      budget: z.coerce
        .number({ error: "Enter the budget" })
        .positive("Budget must be more than ₹0")
        .max(100_000_000, "Budget must be ₹10 crore or less"),
    })
    .refine((r) => r.origin.toLowerCase() !== r.destination.toLowerCase(), {
      message: "Origin and destination must be different",
      path: ["destination"],
    });
}

export type RelocationRequestInput = z.infer<ReturnType<typeof relocationRequestSchema>>;
