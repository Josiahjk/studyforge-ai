"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, FileText, Image as ImageIcon, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { GenerateSourceNotesButton } from "@/components/notes/generate-source-notes-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { estimateSingleGeneration } from "@/lib/generation-estimates";

export type NotesListItem = {
  id: string;
  name: string;
  extension: string;
  imageCount: number;
  chunkCount: number;
  importedAt: string;
  preview: string;
  imageDataUrl?: string | null;
  imageAlt?: string | null;
  generation?: {
    id: string;
    title: string;
    summary: string;
  } | null;
};

function cleanSourcePreview(preview: string) {
  return preview
    .replace(/^Page\s+\d+(?:\s*,\s*Page\s+\d+)+\s+/i, "")
    .replace(/^Page\s+\d+\s+Topic\s*:/i, "Topic:")
    .replace(/^AI vision analysis for\s+(?:image|page)\s+\d+\s*:?\s*/i, "")
    .trim();
}

function sourceCountLabel(file: NotesListItem) {
  const label = file.imageCount > 0 ? "study section" : "chunk";
  return `${file.chunkCount} ${label}${file.chunkCount === 1 ? "" : "s"}`;
}

export function NotesListClient({ files }: { files: NotesListItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState("");
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generatingCombined, setGeneratingCombined] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [error, setError] = useState("");
  const selectedFiles = files.filter((file) => selectedIds.includes(file.id));
  const allSelected = files.length > 0 && selectedFiles.length === files.length;

  async function deleteSource(id: string) {
    setDeletingId(id);
    setError("");
    const response = await fetch(`/api/notes/sources/${id}`, { method: "DELETE" });
    setDeletingId("");
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error?.message || "Could not delete this note.");
      return;
    }
    setSelectedIds((current) => current.filter((selectedId) => selectedId !== id));
    router.refresh();
  }

  async function deleteSelectedSources() {
    if (selectedFiles.length === 0) return;
    setDeletingSelected(true);
    setError("");
    const response = await fetch("/api/notes/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedFiles.map((file) => file.id) }),
    });
    const data = await response.json().catch(() => ({}));
    setDeletingSelected(false);
    if (!response.ok) {
      setError(data.error?.message || "Could not delete the selected notes.");
      return;
    }
    setSelectedIds([]);
    router.refresh();
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]));
  }

  async function generateCombinedNotes() {
    if (selectedFiles.length === 0) return;
    setGeneratingCombined(true);
    setError("");
    setProgress({
      label: selectedFiles.length > 1 ? "Generating combined notes" : "Generating notes",
      detail:
        selectedFiles.length > 1
          ? `Combining ${selectedFiles.length} selected sources into one study guide.`
          : "Building notes from the selected source.",
      estimate: estimateSingleGeneration(Math.max(1, selectedFiles.length), 8),
      startedAt: Date.now(),
    });
    const response = await fetch("/api/ai/generate-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        selectedFiles.length > 1
          ? { fileIds: selectedFiles.map((file) => file.id), mode: "notes_only", difficulty: "student-friendly detailed" }
          : { fileId: selectedFiles[0].id, mode: "notes_only", difficulty: "student-friendly detailed" },
      ),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setGeneratingCombined(false);
      setProgress(null);
      setError(data.error?.message || "Could not generate notes from the selected sources.");
      return;
    }
    setProgress((current) => (current ? { ...current, detail: "Notes saved. Opening the notes page.", complete: true } : current));
    setGeneratingCombined(false);
    router.push(`/notes/${data.id}`);
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {files.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">Combine note sources</p>
              <p className="mt-1 text-sm text-slate-600">{selectedFiles.length} selected for one combined study guide.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => setSelectedIds(allSelected ? [] : files.map((file) => file.id))}>
                {allSelected ? "Clear selection" : "Select all"}
              </Button>
              <Button type="button" onClick={generateCombinedNotes} disabled={generatingCombined || selectedFiles.length === 0}>
                <WandSparkles className="h-4 w-4" />
                {selectedFiles.length > 1 ? `Generate combined notes (${selectedFiles.length})` : "Generate notes"}
              </Button>
              <Button type="button" variant="danger" onClick={deleteSelectedSources} disabled={deletingSelected || selectedFiles.length === 0}>
                <Trash2 className="h-4 w-4" />
                Delete selected
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {progress ? <GenerationProgress progress={progress} /> : null}
      {files.map((file) => {
        const href = file.generation ? `/notes/${file.generation.id}` : `/notes/sources/${file.id}`;
        const selected = selectedIds.includes(file.id);
        return (
          <Card key={file.id} className={selected ? "ring-2 ring-emerald-300" : ""}>
            <CardContent className="grid gap-4 pt-5 md:grid-cols-[auto_96px_1fr_auto] md:items-center">
              <input
                type="checkbox"
                className="h-4 w-4 accent-emerald-600"
                checked={selected}
                onChange={() => toggleSelected(file.id)}
                aria-label={`Select ${file.name}`}
              />
              <div className="flex h-24 items-center justify-center overflow-hidden rounded-md bg-slate-100 ring-1 ring-slate-200">
                {file.imageDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.imageDataUrl} alt={file.imageAlt || file.name} className="h-full w-full object-cover" />
                ) : (
                  <FileText className="h-7 w-7 text-slate-500" />
                )}
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap gap-2">
                  <Badge>{file.extension}</Badge>
                  {file.generation ? (
                    <Badge className="bg-emerald-50 text-emerald-800 ring-emerald-100">
                      <Sparkles className="h-3 w-3" />
                      AI notes
                    </Badge>
                  ) : (
                    <Badge className="bg-slate-50 text-slate-700 ring-slate-200">Source only</Badge>
                  )}
                  {file.imageCount > 0 ? (
                    <Badge className="bg-sky-50 text-sky-800 ring-sky-100">
                      <ImageIcon className="h-3 w-3" />
                      {file.imageCount} images
                    </Badge>
                  ) : null}
                </div>
                <h2 className="truncate font-semibold text-slate-950">{file.generation?.title || file.name}</h2>
                <p className="mt-1 line-clamp-2 text-sm text-slate-600">{file.generation?.summary || cleanSourcePreview(file.preview)}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {sourceCountLabel(file)} / imported {file.importedAt}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Button asChild variant="secondary">
                  <Link href={href}>
                    Open
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                {!file.generation ? (
                  <GenerateSourceNotesButton fileId={file.id} label="Generate notes" variant="secondary" />
                ) : null}
                <Button variant="ghost" size="icon" title="Delete note" onClick={() => deleteSource(file.id)} disabled={deletingId === file.id}>
                  <Trash2 className="h-4 w-4 text-rose-600" />
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
      {files.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-slate-600">Import a PDF, DOCX, image, transcript, or YouTube captions to populate notes.</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
