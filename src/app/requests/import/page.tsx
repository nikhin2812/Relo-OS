import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";

import { ImportForm } from "./import-form";

export default async function ImportPage() {
  const user = await requireUser();
  if (user.role !== "hr_user") notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <Link href="/overview" className="text-sm text-neutral-600 hover:underline">
        ← Back to progress and budget
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>Import relocation requests</CardTitle>
          <CardDescription>
            Upload a CSV with a header row: employee_name, family_size, origin, destination, move_date (YYYY-MM-DD), budget,
            and optionally employee_email. Up to 200 rows. Each row is checked like the request form.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportForm />
        </CardContent>
      </Card>
    </main>
  );
}
