import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const deck = await prisma.deck.findFirst({ where: { id, userId: user.id } });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");

  const share = await prisma.shareLink.create({
    data: {
      deckId: id,
      userId: user.id,
      token: nanoid(16),
    },
  });
  await prisma.deck.update({ where: { id }, data: { isPublic: true } });

  return NextResponse.json({ token: share.token, url: `/share/${share.token}` });
}
