import { NextResponse } from "next/server";
import { hashPassword, setSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { forwardedUrl } from "@/lib/request-url";
import { registerSchema } from "@/lib/validators";

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return { data: await request.json().catch(() => null), redirect: false };
  }
  const form = await request.formData();
  return {
    data: {
      name: String(form.get("name") || ""),
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
  const parsed = registerSchema.safeParse(payload.data);
  if (!parsed.success) {
    return payload.redirect
      ? formRedirect(request, "/register?error=invalid")
      : jsonError(parsed.error.issues[0]?.message || "Invalid registration.", 422);
  }

  const email = parsed.data.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return payload.redirect
      ? formRedirect(request, "/register?error=exists")
      : jsonError("An account with this email already exists.", 409, "EMAIL_EXISTS");
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      stats: { create: {} },
      setting: { create: {} },
    },
  });

  await setSession(user.id);
  if (payload.redirect) return formRedirect(request, "/dashboard");
  return NextResponse.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
}
