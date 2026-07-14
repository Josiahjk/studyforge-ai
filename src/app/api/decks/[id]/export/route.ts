import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/utils";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const deck = await prisma.deck.findFirst({
    where: { id, userId: user.id },
    include: { cards: { orderBy: { createdAt: "asc" } } },
  });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");

  return NextResponse.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    deck: {
      title: deck.title,
      description: deck.description,
      subject: deck.subject,
      tags: parseJsonArray(deck.tagsJson),
      color: deck.color,
      cards: deck.cards.map((card) => ({
        type: card.type,
        question: card.question,
        answer: card.answer,
        clozeText: card.clozeText,
        options: card.optionsJson ? JSON.parse(card.optionsJson) : undefined,
        correctOption: card.correctOption,
        explanation: card.explanation,
        difficulty: card.difficulty,
        tags: parseJsonArray(card.tagsJson),
      })),
    },
  });
}
