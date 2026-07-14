import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { scheduleReview } from "@/lib/sm2";
import { recordStudyResult } from "@/lib/stats";
import { reviewSchema } from "@/lib/validators";

type Context = { params: Promise<{ deckId: string }> };

export async function POST(request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { deckId } = await context.params;

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose a review rating.", 422);

  const card = await prisma.card.findFirst({
    where: { id: parsed.data.cardId, deckId, deck: { userId: user.id } },
  });
  if (!card) return jsonError("Card not found.", 404, "CARD_NOT_FOUND");

  const next = scheduleReview(card, parsed.data.rating);
  await prisma.$transaction([
    prisma.card.update({
      where: { id: card.id },
      data: {
        dueAt: next.dueAt,
        easeFactor: next.easeFactor,
        interval: next.interval,
        repetitions: next.repetitions,
        lapses: next.lapses,
      },
    }),
    prisma.reviewLog.create({
      data: {
        userId: user.id,
        deckId,
        cardId: card.id,
        rating: parsed.data.rating,
        correct: next.correct,
        previousEase: next.previousEase,
        newEase: next.easeFactor,
        previousInterval: next.previousInterval,
        newInterval: next.interval,
      },
    }),
  ]);
  await recordStudyResult(user.id, next.correct);

  return NextResponse.json({ ok: true, next });
}
