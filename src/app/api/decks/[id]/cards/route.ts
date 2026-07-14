import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { cardSchema } from "@/lib/validators";
import { toJsonArray } from "@/lib/utils";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const deck = await prisma.deck.findFirst({ where: { id, userId: user.id } });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");

  const parsed = cardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid card.", 422);

  const card = await prisma.card.create({
    data: {
      deckId: id,
      type: parsed.data.type,
      question: parsed.data.question,
      answer: parsed.data.answer,
      clozeText: parsed.data.clozeText,
      optionsJson: parsed.data.options ? JSON.stringify(parsed.data.options) : null,
      correctOption: parsed.data.correctOption,
      explanation: parsed.data.explanation,
      difficulty: parsed.data.difficulty,
      tagsJson: toJsonArray(parsed.data.tags),
    },
  });
  return NextResponse.json({ card }, { status: 201 });
}
