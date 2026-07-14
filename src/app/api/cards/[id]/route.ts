import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { cardSchema } from "@/lib/validators";
import { toJsonArray } from "@/lib/utils";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const card = await prisma.card.findFirst({
    where: { id, deck: { userId: user.id } },
  });
  if (!card) return jsonError("Card not found.", 404, "CARD_NOT_FOUND");

  const parsed = cardSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid card update.", 422);

  const data: Prisma.CardUpdateInput = {};
  if (parsed.data.type !== undefined) data.type = parsed.data.type;
  if (parsed.data.question !== undefined) data.question = parsed.data.question;
  if (parsed.data.answer !== undefined) data.answer = parsed.data.answer;
  if (parsed.data.clozeText !== undefined) data.clozeText = parsed.data.clozeText;
  if (parsed.data.options !== undefined) data.optionsJson = JSON.stringify(parsed.data.options);
  if (parsed.data.correctOption !== undefined) data.correctOption = parsed.data.correctOption;
  if (parsed.data.explanation !== undefined) data.explanation = parsed.data.explanation;
  if (parsed.data.difficulty !== undefined) data.difficulty = parsed.data.difficulty;
  if (parsed.data.tags !== undefined) data.tagsJson = toJsonArray(parsed.data.tags);

  const updated = await prisma.card.update({ where: { id }, data });
  return NextResponse.json({ card: updated });
}

export async function DELETE(_request: Request, context: Context) {
  const { user, response } = await requireApiUser();
  if (!user) return response;
  const { id } = await context.params;

  const card = await prisma.card.findFirst({
    where: { id, deck: { userId: user.id } },
  });
  if (!card) return jsonError("Card not found.", 404, "CARD_NOT_FOUND");

  await prisma.card.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
