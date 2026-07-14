import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deckSchema } from "@/lib/validators";
import { toJsonArray } from "@/lib/utils";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const parsed = deckSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid deck update.", 422);

  const deck = await prisma.deck.findFirst({ where: { id, userId: user.id } });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");

  const updated = await prisma.deck.update({
    where: { id },
    data: {
      ...("title" in parsed.data ? { title: parsed.data.title } : {}),
      ...("description" in parsed.data ? { description: parsed.data.description } : {}),
      ...("subject" in parsed.data ? { subject: parsed.data.subject } : {}),
      ...("color" in parsed.data ? { color: parsed.data.color } : {}),
      ...("isPublic" in parsed.data ? { isPublic: parsed.data.isPublic } : {}),
      ...("tags" in parsed.data ? { tagsJson: toJsonArray(parsed.data.tags) } : {}),
    },
  });

  return NextResponse.json({ deck: updated });
}

export async function DELETE(_request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const deck = await prisma.deck.findFirst({ where: { id, userId: user.id } });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");
  await prisma.deck.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
