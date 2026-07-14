import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { NoteQuizClient, type NoteQuizQuestion, type QuizSourceImage } from "@/components/notes/note-quiz-client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSourceBackedNotes,
  isWeakGeneratedNotes,
  parseGeneratedArray,
  type GeneratedNoteItem,
  type GeneratedQuizItem,
} from "@/lib/generated-note-data";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ id: string }> };

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledInitialQuestion(question: GeneratedQuizItem): NoteQuizQuestion {
  const choices = question.choices.slice(0, 4);
  const correctAnswer = choices[Math.min(question.correctAnswerIndex, Math.max(0, choices.length - 1))] || choices[0] || "";
  const seed = hashString(`${question.question}\n${choices.join("\n")}\n${correctAnswer}`);
  const random = seededRandom(seed);
  const shuffled = [...choices];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const correctIndex = shuffled.findIndex((choice) => choice.toLowerCase() === correctAnswer.toLowerCase());
  return {
    question: question.question,
    choices: shuffled,
    correctAnswerIndex: Math.max(0, correctIndex),
    answer: correctAnswer,
    hint: question.hint,
    acceptableAnswers: question.acceptableAnswers,
    explanation: question.explanation,
  };
}

export default async function GeneratedNoteQuizPage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const generation = await prisma.generatedNote.findFirst({
    where: { id, file: { userId: user.id } },
    include: { file: { include: { chunks: { orderBy: { chunkIndex: "asc" } }, images: { orderBy: { imageIndex: "asc" } } } } },
  });
  if (!generation) notFound();

  const storedNotes = parseGeneratedArray<GeneratedNoteItem>(generation.notesJson);
  const quiz = parseGeneratedArray<GeneratedQuizItem>(generation.quizJson);
  const sourceBacked = buildSourceBackedNotes(generation.file.originalName, generation.file.chunks);
  const useSourceBacked = isWeakGeneratedNotes(generation.documentTitle, generation.shortSummary, storedNotes);
  const notes = useSourceBacked ? sourceBacked.notes : storedNotes;
  const documentTitle = useSourceBacked ? sourceBacked.documentTitle : generation.documentTitle;
  const shortSummary = useSourceBacked ? sourceBacked.shortSummary : generation.shortSummary;
  const sourceNotes = [
    documentTitle,
    shortSummary,
    ...notes.map((note) => `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`),
  ].join("\n\n");

  const initialQuestions: NoteQuizQuestion[] = quiz
    .filter((question) => question.choices.length >= 2)
    .map(shuffledInitialQuestion);
  const chunkTextByPage = new Map<number, string>();
  for (const chunk of generation.file.chunks) {
    if (!chunk.pageNumber) continue;
    chunkTextByPage.set(chunk.pageNumber, `${chunkTextByPage.get(chunk.pageNumber) || ""}\n${chunk.heading || ""}\n${chunk.cleanedText}`);
  }
  const sourceImages: QuizSourceImage[] = generation.file.images.slice(0, 36).map((image) => {
    const label = image.pageNumber ? `Page ${image.pageNumber}` : `Source image ${image.imageIndex + 1}`;
    const pageText = image.pageNumber ? chunkTextByPage.get(image.pageNumber) || "" : "";
    const nearbyChunk = generation.file.chunks[image.imageIndex] || generation.file.chunks[Math.floor(image.imageIndex / 5)] || generation.file.chunks[0];
    return {
      id: image.id,
      imageIndex: image.imageIndex,
      pageNumber: image.pageNumber,
      label,
      dataUrl: image.dataUrl,
      altText: image.altText,
      searchText: `${label}\n${image.altText || ""}\n${pageText}\n${nearbyChunk?.heading || ""}\n${nearbyChunk?.cleanedText || ""}`.slice(0, 12000),
    };
  });

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader title="Multiple-Choice Quiz" body={documentTitle} />
      <NoteQuizClient
        noteId={generation.id}
        title={documentTitle}
        sourceNotes={sourceNotes}
        sourceImages={sourceImages}
        initialQuestions={initialQuestions}
        mode="practice"
      />
    </AppShell>
  );
}
