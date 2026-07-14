import Link from "next/link";
import { AppShell, PageHeader } from "@/components/layout/app-shell";
import { NotesListClient, type NotesListItem } from "@/components/notes/notes-list-client";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSourceBackedNotes,
  isWeakGeneratedNotes,
  parseGeneratedArray,
  type GeneratedNoteItem,
} from "@/lib/generated-note-data";
import { shellUser } from "@/lib/view-data";

export default async function NotesPage() {
  const user = await requireUser();
  const files = await prisma.uploadedFile.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      chunks: { orderBy: { chunkIndex: "asc" } },
      images: { orderBy: { imageIndex: "asc" }, take: 1 },
      generations: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { chunks: true, images: true, generations: true } },
    },
  });
  const list: NotesListItem[] = files.map((file) => {
    const generation = file.generations[0];
    const storedNotes = generation ? parseGeneratedArray<GeneratedNoteItem>(generation.notesJson) : [];
    const sourceBacked = generation ? buildSourceBackedNotes(file.originalName, file.chunks) : null;
    const useSourceBacked =
      generation && sourceBacked
        ? isWeakGeneratedNotes(generation.documentTitle, generation.shortSummary, storedNotes)
        : false;

    return {
      id: file.id,
      name: file.originalName,
      extension: file.extension,
      imageCount: file._count.images,
      chunkCount: file._count.chunks,
      importedAt: file.createdAt.toLocaleDateString(),
      preview: file.chunks[0]?.cleanedText || "No text preview is available.",
      imageDataUrl: file.images[0]?.dataUrl || null,
      imageAlt: file.images[0]?.altText || null,
      generation: generation
        ? {
            id: generation.id,
            title: useSourceBacked && sourceBacked ? sourceBacked.documentTitle : generation.documentTitle,
            summary: useSourceBacked && sourceBacked ? sourceBacked.shortSummary : generation.shortSummary,
          }
        : null,
    };
  });

  return (
    <AppShell user={shellUser(user)}>
      <PageHeader
        title="Notes"
        body="Imported sources, generated study notes, source images, and quiz material live here."
        action={
          <Button asChild>
            <Link href="/import">Upload New Material</Link>
          </Button>
        }
      />

      <NotesListClient files={list} />
    </AppShell>
  );
}
