import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export function jsonError(message: string, status = 400, code = "BAD_REQUEST") {
  return NextResponse.json({ error: { message, code } }, { status });
}

export async function requireApiUser() {
  const user = await getCurrentUser();
  if (!user) {
    return { user: null, response: jsonError("Please sign in to continue.", 401, "UNAUTHORIZED") };
  }
  return { user, response: null };
}
