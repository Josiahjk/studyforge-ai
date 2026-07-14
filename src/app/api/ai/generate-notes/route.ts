import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildSourceBackedNotes, isWeakGeneratedNotes, type GeneratedNoteItem } from "@/lib/generated-note-data";
import { enforceAiCooldown, generateJson, type ModelMode, OpenRouterError } from "@/lib/openrouter";
import { studyLanguageInstruction } from "@/lib/study-language";

const MAX_COMBINED_SOURCE_FILES = 30;

const requestSchema = z
  .object({
    fileId: z.string().optional(),
    fileIds: z.array(z.string()).max(MAX_COMBINED_SOURCE_FILES).optional(),
    mode: z.enum(["notes_only", "notes_flashcards_quiz"]).default("notes_only"),
    difficulty: z.string().max(80).default("student-friendly"),
  })
  .superRefine((value, context) => {
    if (!value.fileId && (!value.fileIds || value.fileIds.length === 0)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose at least one imported source." });
    }
  });

const generatedNotesSchema = z.object({
  documentTitle: z.string().min(1).catch("Imported document"),
  shortSummary: z.string().min(1).catch("Summary generated from the uploaded document."),
  notes: z.array(
    z.object({
      heading: z.string().min(1).catch("Key idea"),
      explanation: z.string().min(1).catch(""),
      bullets: z.array(z.string()).catch([]),
      sourceChunkIds: z.array(z.string()).catch([]),
    }),
  ).catch([]),
  flashcards: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
      difficulty: z.enum(["easy", "medium", "hard"]).catch("medium"),
      sourceChunkIds: z.array(z.string()).catch([]),
    }),
  ).catch([]),
  quiz: z.array(
    z.object({
      question: z.string().min(1),
      choices: z.array(z.string()).min(4).max(4).catch([]),
      correctAnswerIndex: z.number().int().min(0).max(5).catch(0),
      explanation: z.string().min(1).catch("Review the source note for the reasoning."),
      hint: z.string().catch(""),
      answer: z.string().catch(""),
      acceptableAnswers: z.array(z.string()).catch([]),
      sourceChunkIds: z.array(z.string()).catch([]),
    }),
  ).catch([]),
});

function normalizeGeneratedPayload(payload: unknown, fallbackTitle: string) {
  const raw = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const notes = Array.isArray(raw.notes) ? raw.notes : Array.isArray(raw.generatedNotes) ? raw.generatedNotes : [];
  const flashcards = Array.isArray(raw.flashcards) ? raw.flashcards : Array.isArray(raw.cards) ? raw.cards : [];
  const quizSource = Array.isArray(raw.quiz)
    ? raw.quiz
    : Array.isArray(raw.questions)
      ? raw.questions
      : Array.isArray(raw.quizQuestions)
        ? raw.quizQuestions
        : [];

  return {
    documentTitle:
      typeof raw.documentTitle === "string"
        ? raw.documentTitle
        : typeof raw.document_title === "string"
          ? raw.document_title
          : fallbackTitle,
    shortSummary:
      typeof raw.shortSummary === "string"
        ? raw.shortSummary
        : typeof raw.short_summary === "string"
          ? raw.short_summary
          : typeof raw.summary === "string"
            ? raw.summary
            : "Summary generated from the uploaded document.",
    notes,
    flashcards,
    quiz: quizSource.map((item) => {
      if (!item || typeof item !== "object") return item;
      const question = item as Record<string, unknown>;
      return {
        ...question,
        choices: question.choices || question.options || [],
        correctAnswerIndex:
          question.correctAnswerIndex ??
          question.correct_answer_index ??
          question.answerIndex ??
          question.correctIndex ??
          0,
        answer: question.answer || question.correctAnswer || question.correct_answer || "",
        hint: question.hint || question.clue || "",
        acceptableAnswers: question.acceptableAnswers || question.acceptable_answers || [],
      };
    }),
  };
}

async function saveGeneratedNotes({
  fileId,
  documentTitle,
  shortSummary,
  notes,
  flashcards = [],
  quiz = [],
}: {
  fileId: string;
  documentTitle: string;
  shortSummary: string;
  notes: unknown[];
  flashcards?: unknown[];
  quiz?: unknown[];
}) {
  return prisma.generatedNote.create({
    data: {
      fileId,
      documentTitle,
      shortSummary,
      notesJson: JSON.stringify(notes),
      flashcardsJson: JSON.stringify(flashcards),
      quizJson: JSON.stringify(quiz),
    },
  });
}

function parseStoredArray<T>(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function combinedSourceName(files: Array<{ originalName: string }>) {
  const names = files.map((file) => file.originalName);
  if (names.length <= 2) return `Combined notes - ${names.join(" + ")}`.slice(0, 180);
  return `Combined notes - ${names[0]} + ${names.length - 1} more sources`;
}

function mappedPageNumber(pageNumber: number | null | undefined, offset: number) {
  return typeof pageNumber === "number" && pageNumber > 0 ? pageNumber + offset : null;
}

async function createCombinedSource(
  userId: string,
  files: Array<{
    originalName: string;
    mimeType: string;
    size: number;
    chunks: Array<{
      chunkIndex: number;
      pageNumber: number | null;
      slideNumber: number | null;
      startSeconds: number | null;
      endSeconds: number | null;
      heading: string | null;
      rawText: string;
      cleanedText: string;
    }>;
    images: Array<{
      imageIndex: number;
      pageNumber: number | null;
      timestampSeconds: number | null;
      contentType: string;
      dataUrl: string;
      altText: string | null;
    }>;
  }>,
) {
  let chunkIndex = 0;
  let imageIndex = 0;
  let pageOffset = 0;
  const chunks: Array<{
    chunkIndex: number;
    pageNumber: number | null;
    slideNumber: number | null;
    startSeconds: number | null;
    endSeconds: number | null;
    heading: string;
    rawText: string;
    cleanedText: string;
  }> = [];
  const images: Array<{
    imageIndex: number;
    pageNumber: number | null;
    timestampSeconds: number | null;
    contentType: string;
    dataUrl: string;
    altText: string;
  }> = [];

  for (const file of files) {
    const maxPage = Math.max(
      0,
      ...file.chunks.map((chunk) => chunk.pageNumber || 0),
      ...file.images.map((image) => image.pageNumber || 0),
    );
    for (const chunk of file.chunks) {
      const sourceHeading = chunk.heading ? `${file.originalName}: ${chunk.heading}` : file.originalName;
      chunks.push({
        chunkIndex,
        pageNumber: mappedPageNumber(chunk.pageNumber, pageOffset),
        slideNumber: chunk.slideNumber,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        heading: sourceHeading,
        rawText: `Source: ${file.originalName}\n\n${chunk.rawText}`,
        cleanedText: `Source: ${file.originalName}\n\n${chunk.cleanedText}`,
      });
      chunkIndex += 1;
    }
    for (const image of file.images) {
      images.push({
        imageIndex,
        pageNumber: mappedPageNumber(image.pageNumber, pageOffset),
        timestampSeconds: image.timestampSeconds,
        contentType: image.contentType,
        dataUrl: image.dataUrl,
        altText: `${file.originalName}: ${image.altText || `source image ${image.imageIndex + 1}`}`,
      });
      imageIndex += 1;
    }
    pageOffset += maxPage > 0 ? maxPage + 1 : 0;
  }

  return prisma.uploadedFile.create({
    data: {
      userId,
      originalName: combinedSourceName(files),
      mimeType: "application/studyforge-combined",
      extension: "combined",
      size: files.reduce((total, file) => total + file.size, 0),
      status: "parsed",
      warning: `Combined from ${files.length} imported sources.`,
      chunks: { create: chunks },
      images: images.length ? { create: images } : undefined,
    },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } },
      images: { orderBy: { imageIndex: "asc" } },
    },
  });
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid notes request.", 422);

  const requestedIds = Array.from(new Set(parsed.data.fileIds?.length ? parsed.data.fileIds : parsed.data.fileId ? [parsed.data.fileId] : []));
  const sourceFiles = await prisma.uploadedFile.findMany({
    where: { id: { in: requestedIds }, userId: user.id },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } },
      images: { orderBy: { imageIndex: "asc" } },
    },
  });
  if (sourceFiles.length !== requestedIds.length) return jsonError("Uploaded file not found.", 404, "FILE_NOT_FOUND");
  const orderedFiles = requestedIds.map((id) => sourceFiles.find((file) => file.id === id)).filter(Boolean) as typeof sourceFiles;
  const file = orderedFiles.length > 1 ? await createCombinedSource(user.id, orderedFiles) : orderedFiles[0];
  if (file.chunks.length === 0) return jsonError("This file has no extracted text chunks.", 422, "EMPTY_EXTRACTION");

  const mode = (user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = user.setting?.manualModel;
  const language = studyLanguageInstruction(user.setting?.studyLanguage);
  const sourceBacked = buildSourceBackedNotes(file.originalName, file.chunks);

  if (parsed.data.mode === "notes_only") {
    const existingGeneration = await prisma.generatedNote.findFirst({
      where: { fileId: file.id },
      orderBy: { createdAt: "desc" },
    });
    if (existingGeneration) {
      const existingNotes = parseStoredArray<GeneratedNoteItem>(existingGeneration.notesJson);
      if (
        existingNotes.length > 0 &&
        !isWeakGeneratedNotes(existingGeneration.documentTitle, existingGeneration.shortSummary, existingNotes)
      ) {
        return NextResponse.json({
          id: existingGeneration.id,
          documentTitle: existingGeneration.documentTitle,
          shortSummary: existingGeneration.shortSummary,
          notes: existingNotes,
          flashcards: parseStoredArray(existingGeneration.flashcardsJson),
          quiz: parseStoredArray(existingGeneration.quizJson),
          generationMode: "existing-notes",
        });
      }
    }

    if (sourceBacked.notes.length === 0) {
      return jsonError("Could not create readable note sections from this document.", 422, "EMPTY_NOTES");
    }
    const generation = await saveGeneratedNotes({
      fileId: file.id,
      documentTitle: sourceBacked.documentTitle,
      shortSummary: sourceBacked.shortSummary,
      notes: sourceBacked.notes,
    });
    return NextResponse.json({
      id: generation.id,
      ...sourceBacked,
      flashcards: [],
      quiz: [],
      generationMode: "fast-source-notes",
    });
  }

  const source = file.chunks
    .map(
      (chunk) =>
        `<chunk id="${chunk.id}" page="${chunk.pageNumber || ""}" start="${chunk.startSeconds ?? ""}" end="${chunk.endSeconds ?? ""}" heading="${chunk.heading || ""}">\n${chunk.cleanedText}\n</chunk>`,
    )
    .join("\n\n");

  try {
    await enforceAiCooldown(user.id, "generate-notes", 8);
    const payload = await generateJson<unknown>({
      mode,
      manualModel,
      userId: user.id,
      repairInstruction:
        "Return valid JSON matching documentTitle, shortSummary, notes, flashcards, and quiz. Use source chunk ids from the supplied chunks.",
      messages: [
        {
          role: "system",
          content:
            `You convert uploaded study documents into detailed human study notes. Use only the provided chunks. Do not hallucinate. Return valid JSON only, no markdown. Make the notes useful enough to study from without needing the original document open. ${language.prompt}`,
        },
        {
          role: "user",
          content: `Difficulty: ${parsed.data.difficulty}\nMode: ${parsed.data.mode}\nOutput language: ${language.label}\n\nReturn this JSON shape:\n{\n  "documentTitle": "string",\n  "shortSummary": "string",\n  "notes": [{"heading":"string","explanation":"string","bullets":["string"],"sourceChunkIds":["string"]}],\n  "flashcards": [],\n  "quiz": []\n}\n\nWrite detailed notes, not tiny summaries and not OCR dumps:\n- Create enough note sections to cover all major topics, diagrams, tables, graphs, and processes.\n- Do not write bland phrases like "This page explains", "important text", "extracted text", or "review this topic".\n- Each explanation should feel like a teacher's study guide paragraph: explain what the learner should understand, how the ideas connect, and why the labels matter.\n- When the source has a diagram, explain the parts and functions. Example: for heart anatomy, explain right-side flow, left-side flow, vessels, chambers, valves, and color-arrow meaning.\n- When the source has a graph, explain axes, curve steepness, plateau/final amount, and the conclusion.\n- When the source has a process, include the order and what changes at each step.\n- Each section should include 5 to 10 useful bullets when the source has enough material.\n- Bullets should be study points, not just copied labels. Expand short labels into meaningful facts using only the source.\n- Preserve important vocabulary, formulas, examples, labels, comparisons, and page/chunk references.\n- For notes_only mode, flashcards and quiz must be empty arrays. The Notes page has separate buttons for quiz and flashcards.\n\nUploaded file: ${file.originalName}\n\n${source}`,
        },
      ],
    });
    const checked = generatedNotesSchema.safeParse(normalizeGeneratedPayload(payload, file.originalName));
    if (!checked.success) {
      return jsonError("The model returned generated notes in an unexpected shape.", 502, "MALFORMED_JSON");
    }

    const finalData = isWeakGeneratedNotes(checked.data.documentTitle, checked.data.shortSummary, checked.data.notes)
      ? {
          ...checked.data,
          documentTitle: sourceBacked.documentTitle,
          shortSummary: sourceBacked.shortSummary,
          notes: sourceBacked.notes,
        }
      : checked.data;
    if (finalData.notes.length === 0) {
      return jsonError("Could not create readable note sections from this document.", 422, "EMPTY_NOTES");
    }

    const generation = await saveGeneratedNotes({
      fileId: file.id,
      documentTitle: finalData.documentTitle,
      shortSummary: finalData.shortSummary,
      notes: finalData.notes,
      flashcards: finalData.flashcards,
      quiz: finalData.quiz,
    });

    return NextResponse.json({ id: generation.id, ...finalData, generationMode: "ai-notes" });
  } catch (error) {
    const aiError = error as OpenRouterError;
    if (
      (aiError.code === "MALFORMED_JSON" || aiError.code === "EMPTY_AI_RESPONSE" || aiError.code === "MODEL_UNAVAILABLE") &&
      sourceBacked.notes.length > 0
    ) {
      const generation = await saveGeneratedNotes({
        fileId: file.id,
        documentTitle: sourceBacked.documentTitle,
        shortSummary: sourceBacked.shortSummary,
        notes: sourceBacked.notes,
      });
      return NextResponse.json({
        id: generation.id,
        ...sourceBacked,
        flashcards: [],
        quiz: [],
        generationMode: "fast-source-notes",
        warning: "The free AI model returned malformed JSON, so StudyForge saved notes directly from the imported source analysis instead.",
      });
    }
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "AI_ERROR");
  }
}
