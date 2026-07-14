import "server-only";

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const SESSION_COOKIE = "studyforge_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = {
  userId: string;
  exp: number;
};

function sessionSecret() {
  return process.env.SESSION_SECRET || "studyforge-local-dev-secret";
}

function encode(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function decode(value: string | undefined): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", sessionSecret()).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function setSession(userId: string) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const isHttps =
    forwardedProto === "https" ||
    headerStore.get("x-forwarded-ssl") === "on" ||
    headerStore.get("cf-visitor")?.includes('"scheme":"https"') === true;
  cookieStore.set(
    SESSION_COOKIE,
    encode({ userId, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  );
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const payload = decode(cookieStore.get(SESSION_COOKIE)?.value);
  if (!payload) return null;
  return prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      stats: true,
      setting: true,
      badges: { orderBy: { awardedAt: "desc" } },
    },
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
