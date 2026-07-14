import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { enforceAiCooldown, generateJson, type ModelMode, OpenRouterError } from "@/lib/openrouter";
import { studyLanguageInstruction } from "@/lib/study-language";
import { notesSchema } from "@/lib/validators";

const generatedCardSchema = z.object({
  type: z.enum(["qa", "mcq", "cloze"]),
  question: z.string().min(1),
  answer: z.string().min(1),
  clozeText: z.string().optional().nullable(),
  options: z.array(z.string()).optional(),
  correctOption: z.number().int().optional().nullable(),
  explanation: z.string().optional().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]),
  tags: z.array(z.string()).default([]),
});

const flashcardResponseSchema = z.object({
  cards: z.array(generatedCardSchema).min(1).max(50),
});

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        const record = asRecord(item);
        return stringValue(record.text) || stringValue(record.label) || stringValue(record.value) || stringValue(record.option);
      })
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/\r?\n|;|\|/)
      .map((item) => item.replace(/^[A-D][).:-]\s*/i, "").trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeDifficulty(value: unknown) {
  const difficulty = stringValue(value).toLowerCase();
  if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") return difficulty;
  return "medium";
}

function normalizeCard(item: unknown) {
  const record = asRecord(item);
  const question = stringValue(record.question) || stringValue(record.prompt) || stringValue(record.front) || stringValue(record.term);
  let answer =
    stringValue(record.answer) ||
    stringValue(record.back) ||
    stringValue(record.correctAnswer) ||
    stringValue(record.correct_answer) ||
    stringValue(record.definition);
  const options = stringArray(record.options || record.choices);
  const clozeText = stringValue(record.clozeText) || stringValue(record.cloze_text);
  const rawType = stringValue(record.type).toLowerCase();
  let type: "qa" | "mcq" | "cloze" = rawType === "mcq" || rawType === "multiple-choice" ? "mcq" : rawType === "cloze" ? "cloze" : "qa";
  if (type === "qa" && clozeText) type = "cloze";
  if (type === "qa" && options.length >= 2) type = "mcq";

  let correctOption =
    typeof record.correctOption === "number"
      ? record.correctOption
      : typeof record.correctIndex === "number"
        ? record.correctIndex
        : typeof record.correctAnswerIndex === "number"
          ? record.correctAnswerIndex
          : null;

  if (type === "mcq" && options.length >= 2) {
    const matchIndex = options.findIndex((option) => option.toLowerCase() === answer.toLowerCase());
    if (matchIndex >= 0) correctOption = matchIndex;
    if (correctOption !== null && options[correctOption]) answer = options[correctOption];
  } else {
    type = clozeText ? "cloze" : "qa";
    correctOption = null;
  }

  if (!question || !answer) return null;
  return {
    type,
    question,
    answer,
    clozeText: clozeText || null,
    options: type === "mcq" ? options.slice(0, 6) : undefined,
    correctOption: type === "mcq" && correctOption !== null && correctOption >= 0 && correctOption < Math.min(options.length, 6) ? correctOption : null,
    explanation: stringValue(record.explanation) || stringValue(record.reason) || null,
    difficulty: normalizeDifficulty(record.difficulty),
    tags: stringArray(record.tags).slice(0, 12),
  };
}

function normalizeFlashcardPayload(payload: unknown, requestedCount: number) {
  const raw = asRecord(payload);
  const source = Array.isArray(raw.cards)
    ? raw.cards
    : Array.isArray(raw.flashcards)
      ? raw.flashcards
      : Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(payload)
          ? payload
          : [];
  const cards = source.map(normalizeCard).filter(Boolean).slice(0, requestedCount);
  const warning =
    cards.length < requestedCount
      ? `The source material only supports ${cards.length} unique flashcards right now, so I created ${cards.length} instead of ${requestedCount}.`
      : null;
  return { cards, warning };
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = notesSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid notes.", 422);

  const mode = (parsed.data.modelMode || user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = parsed.data.manualModel || user.setting?.manualModel;
  const language = studyLanguageInstruction(user.setting?.studyLanguage);

  try {
    await enforceAiCooldown(user.id, "flashcards", 1);
    const payload = await generateJson<unknown>({
      mode,
      manualModel,
      userId: user.id,
      repairInstruction: "Convert the response into {\"cards\":[...]} with valid flashcard JSON.",
      messages: [
        {
          role: "system",
          content:
            `You create original study flashcards. Return valid JSON only. Do not include markdown. Make mixed qa, mcq, and cloze cards when appropriate. Use only the supplied notes and do not invent extra material to reach a requested count. ${language.prompt}`,
        },
        {
          role: "user",
          content: `Subject: ${parsed.data.subject}\nOutput language: ${language.label}\nCreate up to ${parsed.data.count} flashcards from these notes. If the material only supports fewer unique flashcards, return only that many. Each card needs type, question, answer, difficulty, tags, and optional explanation/options/correctOption/clozeText.\n\nReturn this exact JSON shape:\n{"cards":[{"type":"qa","question":"string","answer":"string","difficulty":"medium","tags":["string"],"explanation":"string"}]}\n\nNotes:\n${parsed.data.notes}`,
        },
      ],
    });
    const normalized = normalizeFlashcardPayload(payload, parsed.data.count);
    if (normalized.cards.length === 0) {
      return jsonError("The source material does not contain enough distinct study material to create flashcards.", 422, "INSUFFICIENT_SOURCE");
    }
    const checked = flashcardResponseSchema.safeParse(normalized);
    if (!checked.success) {
      return jsonError("The model returned card JSON in an unexpected shape.", 502, "MALFORMED_JSON");
    }
    return NextResponse.json({
      ...checked.data,
      requestedCount: parsed.data.count,
      generatedCount: checked.data.cards.length,
      maximumSupported: checked.data.cards.length,
      warning: normalized.warning,
    });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "AI_ERROR");
  }
}
