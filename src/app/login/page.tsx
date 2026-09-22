import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Relo OS</CardTitle>
          <CardDescription>Sign in to your relocation workspace</CardDescription>
        </CardHeader>
        <CardContent>
          {error === "no-profile" && (
            <p role="alert" className="mb-4 text-sm text-red-600">
              This login has no access yet. Ask your RMC admin to set up your account.
            </p>
          )}
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
