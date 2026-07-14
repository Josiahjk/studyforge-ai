import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const { id } = await context.params;
  const file = await prisma.uploadedFile.findFirst({ where: { id, userId: user.id }, select: { id: true } });
  if (!file) return jsonError("Note source not found.", 404, "NOTE_NOT_FOUND");

  await prisma.uploadedFile.delete({ where: { id: file.id } });
  return NextResponse.json({ ok: true });
}
