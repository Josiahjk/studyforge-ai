"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AuthForm({ mode, initialError = "" }: { mode: "login" | "register"; initialError?: string }) {
  const router = useRouter();
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload =
      mode === "register"
        ? {
            name: String(form.get("name") || ""),
            email: String(form.get("email") || ""),
            password: String(form.get("password") || ""),
          }
        : {
            email: String(form.get("email") || ""),
            password: String(form.get("password") || ""),
          };
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setLoading(false);
    if (!response.ok) {
      setError(data.error?.message || "Something went wrong.");
      return;
    }
    router.refresh();
    window.location.assign("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7fbf8] p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Link href="/" className="mb-4 flex items-center gap-2 text-sm font-bold text-emerald-800">
            <Sparkles className="h-5 w-5" />
            StudyForge AI
          </Link>
          <CardTitle>{mode === "login" ? "Welcome back" : "Create your workspace"}</CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Use the demo account or your local account."
              : "Start a local learning space with private decks."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action={`/api/auth/${mode}`} onSubmit={submit} className="space-y-4">
            {mode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={mode === "login" ? "demo@studyforge.local" : ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                defaultValue={mode === "login" ? "studyforge123" : ""}
                required
              />
            </div>
            {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            <Button className="w-full" disabled={loading}>
              {loading ? "Working..." : mode === "login" ? "Log in" : "Create account"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-slate-600">
            {mode === "login" ? "No account yet?" : "Already have an account?"}{" "}
            <Link className="font-semibold text-emerald-800" href={mode === "login" ? "/register" : "/login"}>
              {mode === "login" ? "Register" : "Log in"}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
