import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { cleanAiTextResponse } from "@/lib/ai-text";
import { prisma } from "@/lib/db";
import {
  buildSourceBackedNotes,
  isWeakGeneratedNotes,
  parseGeneratedArray,
  type GeneratedNoteItem,
} from "@/lib/generated-note-data";
import { enforceAiCooldown, type ModelMode, OpenRouterError, openRouterChat } from "@/lib/openrouter";
import { studyLanguageInstruction } from "@/lib/study-language";

type RouteContext = { params: Promise<{ id: string }> };

const askSchema = z.object({
  question: z.string().min(2).max(1000),
});

export async function POST(request: Request, context: RouteContext) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = askSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Ask a question about these notes.", 422);

  const { id } = await context.params;
  const generation = await prisma.generatedNote.findFirst({
    where: { id, file: { userId: user.id } },
    include: { file: { include: { chunks: { orderBy: { chunkIndex: "asc" } } } } },
  });
  if (!generation) return jsonError("Generated notes not found.", 404, "NOTES_NOT_FOUND");

  const storedNotes = parseGeneratedArray<GeneratedNoteItem>(generation.notesJson);
  const sourceBacked = buildSourceBackedNotes(generation.file.originalName, generation.file.chunks);
  const useSourceBacked = isWeakGeneratedNotes(generation.documentTitle, generation.shortSummary, storedNotes);
  const notes = useSourceBacked ? sourceBacked.notes : storedNotes;
  const documentTitle = useSourceBacked ? sourceBacked.documentTitle : generation.documentTitle;
  const shortSummary = useSourceBacked ? sourceBacked.shortSummary : generation.shortSummary;
  const source = [
    `Title: ${documentTitle}`,
    `Summary: ${shortSummary}`,
    ...notes.map((note) => `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`),
    "Source chunks:",
    ...generation.file.chunks.map(
      (chunk) =>
        `Chunk ${chunk.chunkIndex + 1}${chunk.pageNumber ? ` page ${chunk.pageNumber}` : ""}${
          chunk.startSeconds !== null ? ` at ${Math.round(chunk.startSeconds)}s` : ""
        }:\n${chunk.cleanedText}`,
    ),
  ].join("\n\n");

  const mode = (user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = user.setting?.manualModel;
  const language = studyLanguageInstruction(user.setting?.studyLanguage);

  try {
    await enforceAiCooldown(user.id, "notes-ask", 4);
    const answer = cleanAiTextResponse(await openRouterChat({
      mode,
      manualModel,
      userId: user.id,
      temperature: 0.35,
      messages: [
        {
          role: "system",
          content:
            `Answer questions using only the supplied StudyForge notes and source chunks. If the answer is not in the notes, say what is missing and suggest where to look in the source. Keep the answer clear and student-friendly. ${language.prompt}`,
        },
        {
          role: "user",
          content: `Notes:\n${source}\n\nQuestion: ${parsed.data.question}`,
        },
      ],
    }));

    return NextResponse.json({ answer });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "AI_ERROR");
  }
}
