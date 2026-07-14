import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, Brain, Image as ImageIcon, Layers3 } from "lucide-react";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { NoteActionsClient } from "@/components/notes/note-actions-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSourceBackedNotes,
  isWeakGeneratedNotes,
  parseGeneratedArray,
  type GeneratedFlashcardItem,
  type GeneratedNoteItem,
  type GeneratedQuizItem,
} from "@/lib/generated-note-data";
import { shouldShowVisualForNote, toNoteVisual, type NoteVisual } from "@/lib/note-visuals";
import { shellUser } from "@/lib/view-data";

type PageProps = { params: Promise<{ id: string }> };

function splitStudyBullet(value: string) {
  const match = /^([^:=]{2,86})[:=]\s*(.+)$/i.exec(value);
  if (!match) return null;
  const term = match[1].replace(/^\d+\.\s*/, "").trim();
  const detail = match[2].trim();
  if (!term || !detail || /^[.:]+$/.test(detail)) return null;
  return { term, detail };
}

function isStudyCue(value: string) {
  return /^(flow to remember|oxygenated flow|color cue|graph cue|plateau cue|order to remember|comparison cue|transport cue|memory cue):/i.test(value);
}

export default async function GeneratedNotePage({ params }: PageProps) {
  const user = await requireUser();
  const { id } = await params;
  const generation = await prisma.generatedNote.findFirst({
    where: { id, file: { userId: user.id } },
    include: {
      file: {
        include: {
          chunks: { orderBy: { chunkIndex: "asc" } },
          images: { orderBy: { imageIndex: "asc" } },
        },
      },
    },
  });
  if (!generation) notFound();
  const savedNote = generation;

  const storedNotes = parseGeneratedArray<GeneratedNoteItem>(savedNote.notesJson);
  const flashcards = parseGeneratedArray<GeneratedFlashcardItem>(savedNote.flashcardsJson);
  const quiz = parseGeneratedArray<GeneratedQuizItem>(savedNote.quizJson);
  const sourceBacked = buildSourceBackedNotes(savedNote.file.originalName, savedNote.file.chunks);
  const useSourceBacked = isWeakGeneratedNotes(savedNote.documentTitle, savedNote.shortSummary, storedNotes);
  const notes = useSourceBacked ? sourceBacked.notes : storedNotes;
  const documentTitle = useSourceBacked ? sourceBacked.documentTitle : savedNote.documentTitle;
  const shortSummary = useSourceBacked ? sourceBacked.shortSummary : savedNote.shortSummary;
  const chunkPage = new Map(savedNote.file.chunks.map((chunk) => [chunk.id, chunk.pageNumber]));
  const chunkText = new Map(savedNote.file.chunks.map((chunk) => [chunk.id, chunk.cleanedText]));
  const sourceNotes = [
    documentTitle,
    shortSummary,
    ...notes.map((note) => `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`),
  ].join("\n\n");

  function imagesForNote(note: GeneratedNoteItem): NoteVisual[] {
    const sourceText = note.sourceChunkIds.map((chunkId) => chunkText.get(chunkId) || "").join("\n\n");
    if (!shouldShowVisualForNote(note, sourceText)) return [];
    const pages = new Set(note.sourceChunkIds.map((chunkId) => chunkPage.get(chunkId)).filter(Boolean));
    if (note.pageNumber) pages.add(note.pageNumber);
    if (pages.size === 0) return [];
    const images = savedNote.file.images.filter((image) => image.pageNumber && pages.has(image.pageNumber)).slice(0, 1);
    return images.map((image) => toNoteVisual(image));
  }

  const noteVisualEntries = notes.map((note, index) => [`${note.heading}-${index}`, imagesForNote(note)] as const);
  const noteVisuals = new Map(noteVisualEntries);
  const keyVisuals = Array.from(
    new Map(noteVisualEntries.flatMap(([, images]) => images.map((image) => [image.id, image] as const))).values(),
  ).slice(0, 6);

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader
        title={documentTitle}
        body={`${savedNote.file.originalName} / ${notes.length} note sections / ${savedNote.file.images.length} source images`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href={`/notes/sources/${savedNote.file.id}`}>
                <BookOpen className="h-4 w-4" />
                Source
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/notes/${savedNote.id}/quiz`}>
                <Brain className="h-4 w-4" />
                Multiple-Choice Quiz
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-5">
              <p className="text-sm leading-7 text-slate-700">{shortSummary}</p>
            </CardContent>
          </Card>

          <NoteActionsClient noteId={savedNote.id} title={documentTitle} sourceNotes={sourceNotes} />

          {notes.map((note, index) => {
            const noteImages = noteVisuals.get(`${note.heading}-${index}`) || [];
            const cueBullets = note.bullets.filter(isStudyCue);
            const definitionBullets = note.bullets
              .filter((bullet) => !isStudyCue(bullet))
              .map((bullet) => ({ bullet, parts: splitStudyBullet(bullet) }))
              .filter((item): item is { bullet: string; parts: { term: string; detail: string } } => Boolean(item.parts));
            const definitionKeys = new Set(definitionBullets.map((item) => item.bullet));
            const regularBullets = note.bullets.filter((bullet) => !isStudyCue(bullet) && !definitionKeys.has(bullet));
            return (
              <Card key={`${note.heading}-${index}`}>
                <CardHeader>
                  <CardTitle>{note.heading}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-7 text-slate-700">{note.explanation}</p>
                  {cueBullets.length ? (
                    <div className="grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                      {cueBullets.map((bullet) => {
                        const parts = splitStudyBullet(bullet);
                        return (
                          <p key={bullet} className="text-sm leading-6 text-emerald-950">
                            {parts ? <span className="font-semibold">{parts.term}: </span> : null}
                            {parts ? parts.detail : bullet}
                          </p>
                        );
                      })}
                    </div>
                  ) : null}
                  {noteImages.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {noteImages.map((image) => (
                        <figure key={image.id} className="overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={image.displayDataUrl} alt={image.altText || note.heading} className="max-h-80 w-full object-contain" />
                          <figcaption className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">Source visual</figcaption>
                        </figure>
                      ))}
                    </div>
                  ) : null}
                  {definitionBullets.length ? (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-normal text-slate-500">Key terms and labels</h3>
                      <dl className="grid gap-2 sm:grid-cols-2">
                        {definitionBullets.map(({ bullet, parts }) => (
                          <div key={bullet} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                            <dt className="text-sm font-semibold text-slate-950">{parts.term}</dt>
                            <dd className="mt-1 text-sm leading-6 text-slate-600">{parts.detail}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ) : null}
                  {regularBullets.length ? (
                    <div>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-normal text-slate-500">Study points</h3>
                      <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-600">
                        {regularBullets.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="space-y-6">
          {keyVisuals.length ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-sky-700" />
                  Key visuals
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                {keyVisuals.map((image) => (
                  <figure key={image.id} className="overflow-hidden rounded-md bg-slate-50 ring-1 ring-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.displayDataUrl} alt={image.altText || savedNote.file.originalName} className="h-28 w-full object-contain" />
                    <figcaption className="px-2 py-1 text-xs text-slate-500">Source visual</figcaption>
                  </figure>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers3 className="h-4 w-4 text-emerald-700" />
                Generated material
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>{flashcards.length} flashcards saved in this note generation.</p>
              <p>{quiz.length} multiple-choice quiz prompts available.</p>
              <div className="flex flex-wrap gap-2">
                <Badge>{savedNote.file.extension}</Badge>
                <Badge className="bg-slate-50 text-slate-700 ring-slate-200">{savedNote.file.chunks.length} chunks</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
