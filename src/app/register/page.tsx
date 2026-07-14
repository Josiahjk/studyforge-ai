import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { getCurrentUser } from "@/lib/auth";

export default async function RegisterPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  const params = await searchParams;
  const initialError =
    params?.error === "exists"
      ? "An account with this email already exists."
      : params?.error
        ? "Check your name, email, and password."
        : "";
  return <AuthForm mode="register" initialError={initialError} />;
}
