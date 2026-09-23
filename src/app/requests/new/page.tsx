import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

import { RequestForm } from "./request-form";

// Planning calls the AI, which can take a while.
export const maxDuration = 180;

export default async function NewRequestPage() {
  const user = await requireUser();
  if (user.role !== "hr_user") notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <Link href="/dashboard" className="text-sm text-neutral-600 hover:underline">
        ← Back to relocations
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>New relocation request</CardTitle>
          <CardDescription>
            When you submit, Relo OS drafts a relocation plan with services, costs and policy checks for your RMC to review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm minDate={new Date().toISOString().slice(0, 10)} />
        </CardContent>
      </Card>
    </main>
  );
}
