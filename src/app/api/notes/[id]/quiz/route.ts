import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { MAX_QUIZ_QUESTIONS } from "@/lib/validators";

type RouteContext = { params: Promise<{ id: string }> };

const savedQuestionSchema = z.object({
  question: z.string().min(1).max(2000),
  choices: z.array(z.string().min(1).max(800)).min(2).max(4),
  correctAnswerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1).max(2000),
  hint: z.string().max(800).optional().default(""),
  answer: z.string().max(800).optional().default(""),
  acceptableAnswers: z.array(z.string().min(1).max(800)).max(8).optional().default([]),
});

const saveQuizSchema = z.object({
  questions: z.array(savedQuestionSchema).min(1).max(MAX_QUIZ_QUESTIONS),
});

export async function PATCH(request: Request, context: RouteContext) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = saveQuizSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid quiz questions.", 422);

  const { id } = await context.params;
  const generation = await prisma.generatedNote.findFirst({
    where: { id, file: { userId: user.id } },
    select: { id: true },
  });
  if (!generation) return jsonError("Generated notes not found.", 404, "NOTES_NOT_FOUND");

  const questions = parsed.data.questions.map((question) => ({
    question: question.question,
    choices: question.choices.slice(0, 4),
    correctAnswerIndex: Math.min(question.correctAnswerIndex, question.choices.length - 1),
    answer:
      question.answer ||
      question.choices[Math.min(question.correctAnswerIndex, question.choices.length - 1)] ||
      question.choices[0] ||
      "",
    hint: question.hint,
    acceptableAnswers: question.acceptableAnswers,
    explanation: question.explanation,
    sourceChunkIds: [],
  }));

  await prisma.generatedNote.update({
    where: { id },
    data: { quizJson: JSON.stringify(questions) },
  });

  return NextResponse.json({ saved: true, questions });
}
