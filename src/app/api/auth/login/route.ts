import { NextResponse } from "next/server";
import { setSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { forwardedUrl } from "@/lib/request-url";
import { loginSchema } from "@/lib/validators";

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { data: await request.json().catch(() => null), redirect: false };
  }
  const form = await request.formData();
  return {
    data: {
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
    },
    redirect: true,
  };
}

function formRedirect(request: Request, path: string) {
  return NextResponse.redirect(forwardedUrl(request, path), { status: 303 });
}

export async function POST(request: Request) {
  const payload = await readPayload(request);
  const parsed = loginSchema.safeParse(payload.data);
  if (!parsed.success) {
    return payload.redirect ? formRedirect(request, "/login?error=invalid") : jsonError("Enter a valid email and password.", 422);
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return payload.redirect
      ? formRedirect(request, "/login?error=invalid")
      : jsonError("Email or password is incorrect.", 401, "INVALID_CREDENTIALS");
  }

  await setSession(user.id);
  if (payload.redirect) return formRedirect(request, "/dashboard");
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
}
