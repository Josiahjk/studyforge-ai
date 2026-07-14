import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";

const submitSchema = z.object({
  score: z.number().int().min(0),
  total: z.number().int().min(1).max(100),
  questions: z.array(z.unknown()).max(100),
  answers: z.array(z.unknown()).max(100),
});

type Context = { params: Promise<{ deckId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { deckId } = await context.params;

  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid quiz attempt.", 422);

  const deck = await prisma.deck.findFirst({ where: { id: deckId, userId: user.id } });
  if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");

  const attempt = await prisma.quizAttempt.create({
    data: {
      userId: user.id,
      deckId,
      score: parsed.data.score,
      total: parsed.data.total,
      questionsJson: JSON.stringify(parsed.data.questions),
      answersJson: JSON.stringify(parsed.data.answers),
    },
  });
  return NextResponse.json({ attempt });
}
