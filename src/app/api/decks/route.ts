import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { deckSchema } from "@/lib/validators";
import { toJsonArray } from "@/lib/utils";

export async function GET() {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const decks = await prisma.deck.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    include: { cards: { select: { dueAt: true } }, _count: { select: { cards: true } } },
  });

  return NextResponse.json({
    decks: decks.map((deck) => ({
      ...deck,
      dueCount: deck.cards.filter((card) => card.dueAt <= new Date()).length,
      cards: undefined,
    })),
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = deckSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid deck.", 422);

  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      title: parsed.data.title,
      description: parsed.data.description,
      subject: parsed.data.subject,
      tagsJson: toJsonArray(parsed.data.tags),
      color: parsed.data.color,
      isPublic: parsed.data.isPublic,
    },
  });
  return NextResponse.json({ deck }, { status: 201 });
}
