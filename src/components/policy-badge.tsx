import { cn } from "@/lib/utils";

const STYLES = {
  within_policy: "bg-green-50 text-green-800 border-green-200",
  needs_review: "bg-amber-50 text-amber-800 border-amber-200",
  out_of_policy: "bg-red-50 text-red-800 border-red-200",
} as const;

const LABELS = {
  within_policy: "Within policy",
  needs_review: "Needs review",
  out_of_policy: "Out of policy",
} as const;

export function PolicyBadge({ status }: { status: keyof typeof STYLES }) {
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", STYLES[status])}>
      {LABELS[status]}
    </span>
  );
}
