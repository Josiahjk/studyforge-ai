import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";

const deleteSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});

export async function DELETE(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose at least one note source to delete.", 422);

  const deleted = await prisma.uploadedFile.deleteMany({
    where: {
      userId: user.id,
      id: { in: Array.from(new Set(parsed.data.ids)) },
    },
  });

  return NextResponse.json({ ok: true, deleted: deleted.count });
}
