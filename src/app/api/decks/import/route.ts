import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { cardSchema, deckSchema } from "@/lib/validators";
import { toJsonArray } from "@/lib/utils";

const importSchema = z.object({
  deck: deckSchema.extend({
    cards: z.array(cardSchema).min(1).max(200),
  }),
});

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid deck JSON.", 422);

  const deck = await prisma.deck.create({
    data: {
      userId: user.id,
      title: parsed.data.deck.title,
      description: parsed.data.deck.description,
      subject: parsed.data.deck.subject,
      tagsJson: toJsonArray(parsed.data.deck.tags),
      color: parsed.data.deck.color,
      cards: {
        create: parsed.data.deck.cards.map((card) => ({
          type: card.type,
          question: card.question,
          answer: card.answer,
          clozeText: card.clozeText,
          optionsJson: card.options ? JSON.stringify(card.options) : null,
          correctOption: card.correctOption,
          explanation: card.explanation,
          difficulty: card.difficulty,
          tagsJson: toJsonArray(card.tags),
        })),
      },
    },
  });

  return NextResponse.json({ deck }, { status: 201 });
}
