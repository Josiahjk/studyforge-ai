"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Captions,
  Clock3,
  ClipboardPaste,
  FileAudio,
  FileText,
  ImageIcon,
  Presentation,
  Save,
  Trash2,
  Upload,
  Video,
  WandSparkles,
} from "lucide-react";
import { FlashcardReviewer, type ReviewFlashcard } from "@/components/flashcards/flashcard-reviewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { estimateBatchedGeneration, estimateSingleGeneration } from "@/lib/generation-estimates";
import { cn } from "@/lib/utils";

const NO_TRANSCRIPT_MESSAGE =
  "No transcript was found for this video. To keep this free and safe, upload an audio/video file you own, or paste the transcript manually.";

type DraftCard = ReviewFlashcard;

type ParsedUpload = {
  id: string;
  name: string;
  warning?: string | null;
  imageCount?: number;
  chunks: Array<{ id: string; chunkIndex: number; pageNumber?: number | null; heading?: string | null; preview: string }>;
};

type GeneratedDocument = {
  id: string;
  documentTitle: string;
  shortSummary: string;
  notes: Array<{ heading: string; explanation: string; bullets: string[]; sourceChunkIds: string[] }>;
  flashcards: Array<{ question: string; answer: string; difficulty: "easy" | "medium" | "hard"; sourceChunkIds: string[] }>;
  quiz: Array<{
    question: string;
    choices: string[];
    correctAnswerIndex: number;
    explanation: string;
    hint?: string;
    answer?: string;
    acceptableAnswers?: string[];
    sourceChunkIds: string[];
  }>;
};

type ImportResponse = {
  file: {
    id: string;
    name: string;
    warning?: string | null;
    imageCount?: number;
  };
  text: string;
  chunks: ParsedUpload["chunks"];
};

type ImportJobResponse = {
  jobId: string;
  statusUrl: string;
  job: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    label: string;
    detail: string;
    percent: number;
  };
};

type ImportJobStatusResponse = {
  job: {
    id: string;
    status: "queued" | "running" | "completed" | "failed";
    label: string;
    detail: string;
    percent: number;
    result?: ImportResponse;
    error?: { message?: string; code?: string };
  };
};

type ApiErrorPayload = {
  error?: { message?: string; code?: string };
};

type ProgressState = {
  ownerUserId?: string;
  label: string;
  detail: string;
  percent: number;
  startedAt: number;
  statusUrl?: string;
  done?: boolean;
  failed?: boolean;
};

const IMPORT_WORKSPACE_KEY = "studyforge-import-workspace";
const IMPORT_PROGRESS_KEY = "studyforge-import-progress";
const FLASHCARD_BATCH_SIZE = 10;
const MAX_BATCH_IMPORT_FILES = 30;
type TranscriptLanguage = "auto" | "en" | "ms" | "id" | "zh";

const transcriptLanguages: Array<{ value: TranscriptLanguage; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "ms", label: "Melayu" },
  { value: "id", label: "Indonesia" },
  { value: "zh", label: "Chinese" },
];

type PersistedImportWorkspace = Partial<{
  ownerUserId: string;
  title: string;
  subject: string;
  notes: string;
  flashcardCount: number;
  drafts: DraftCard[];
  parsedUpload: ParsedUpload | null;
  parsedUploads: ParsedUpload[];
  selectedUploadIds: string[];
  generatedDocument: GeneratedDocument | null;
  flashcardNotice: string;
  youtubeMessage: string;
  showYoutubeFallback: boolean;
}>;

function clampImportCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(50, Math.max(1, Math.round(value)));
}

function isImageUpload(file: File) {
  return /\.(png|jpe?g)$/i.test(file.name) || file.type === "image/png" || file.type === "image/jpeg";
}

function cleanChunkPreview(preview: string) {
  return preview
    .replace(/^Page\s+\d+(?:\s*,\s*Page\s+\d+)+\s+/i, "")
    .replace(/^Page\s+\d+\s+Topic\s*:/i, "Topic:")
    .replace(/^AI vision analysis for\s+(?:image|page)\s+\d+\s*:?\s*/i, "")
    .trim();
}

function sourceMeta(upload: ParsedUpload) {
  const sectionLabel = upload.imageCount ? "study section" : "text chunk";
  const sectionText = `${upload.chunks.length} ${sectionLabel}${upload.chunks.length === 1 ? "" : "s"}`;
  return `${sectionText}${upload.imageCount ? ` / ${upload.imageCount} source image(s)` : ""}`;
}

function chunkDisplayLabel(upload: ParsedUpload, chunk: ParsedUpload["chunks"][number]) {
  const base = upload.imageCount ? "Section" : "Chunk";
  return `${base} ${chunk.chunkIndex + 1}${chunk.pageNumber ? ` / page ${chunk.pageNumber}` : ""}`;
}

function appendUniqueDraftCards(existing: DraftCard[], incoming: DraftCard[], limit: number) {
  const seen = new Set(existing.map((card) => card.question.trim().toLowerCase()));
  const output = [...existing];
  for (const card of incoming) {
    const key = card.question.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(card);
    if (output.length >= limit) break;
  }
  return output;
}

function readSavedWorkspace(currentUserId: string): PersistedImportWorkspace {
  if (typeof window === "undefined") return {};
  const savedWorkspace = window.sessionStorage.getItem(IMPORT_WORKSPACE_KEY);
  if (!savedWorkspace) return {};
  try {
    const value = JSON.parse(savedWorkspace) as PersistedImportWorkspace;
    if (value.ownerUserId !== currentUserId) {
      window.sessionStorage.removeItem(IMPORT_WORKSPACE_KEY);
      return {};
    }
    return value;
  } catch {
    window.sessionStorage.removeItem(IMPORT_WORKSPACE_KEY);
    return {};
  }
}

function readSavedProgress(currentUserId: string): ProgressState | null {
  if (typeof window === "undefined") return null;
  const savedProgress = window.sessionStorage.getItem(IMPORT_PROGRESS_KEY);
  if (!savedProgress) return null;
  try {
    const value = JSON.parse(savedProgress) as ProgressState & { updatedAt?: number };
    if (value.ownerUserId !== currentUserId) {
      window.sessionStorage.removeItem(IMPORT_PROGRESS_KEY);
      return null;
    }
    const ageMs = Date.now() - (value.updatedAt || value.startedAt || Date.now());
    if (value.done || value.failed || ageMs < 10 * 60 * 1000) return value;
    return {
      ownerUserId: currentUserId,
      label: "Previous import interrupted",
      detail: "The browser left while the upload was still running. Start the upload again.",
      percent: 0,
      startedAt: Date.now(),
      failed: true,
    };
  } catch {
    window.sessionStorage.removeItem(IMPORT_PROGRESS_KEY);
    return null;
  }
}

export function ImportClient({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [storageRestored, setStorageRestored] = useState(false);
  const [title, setTitle] = useState("Imported study deck");
  const [subject, setSubject] = useState("General");
  const [notes, setNotes] = useState("");
  const [flashcardCount, setFlashcardCount] = useState(10);
  const [drafts, setDrafts] = useState<DraftCard[]>([]);
  const [parsedUpload, setParsedUpload] = useState<ParsedUpload | null>(null);
  const [parsedUploads, setParsedUploads] = useState<ParsedUpload[]>([]);
  const [selectedUploadIds, setSelectedUploadIds] = useState<string[]>([]);
  const [generatedDocument, setGeneratedDocument] = useState<GeneratedDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [deletingSources, setDeletingSources] = useState(false);
  const [error, setError] = useState("");
  const [flashcardNotice, setFlashcardNotice] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeLanguage, setYoutubeLanguage] = useState<TranscriptLanguage>("auto");
  const [youtubeMessage, setYoutubeMessage] = useState("");
  const [showYoutubeFallback, setShowYoutubeFallback] = useState(false);
  const [transcriptTitle, setTranscriptTitle] = useState("Pasted transcript");
  const [transcriptText, setTranscriptText] = useState("");
  const [mediaLanguage, setMediaLanguage] = useState<TranscriptLanguage>("auto");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressState | null>(null);
  const resumedStatusUrl = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedWorkspace = readSavedWorkspace(currentUserId);
      setTitle(savedWorkspace.title || "Imported study deck");
      setSubject(savedWorkspace.subject || "General");
      setNotes(savedWorkspace.notes || "");
      setFlashcardCount(clampImportCount(savedWorkspace.flashcardCount || 10));
      setDrafts(savedWorkspace.drafts || []);
      const restoredUploads = savedWorkspace.parsedUploads || (savedWorkspace.parsedUpload ? [savedWorkspace.parsedUpload] : []);
      setParsedUpload(savedWorkspace.parsedUpload || restoredUploads[0] || null);
      setParsedUploads(restoredUploads);
      setSelectedUploadIds(
        (savedWorkspace.selectedUploadIds || (savedWorkspace.parsedUpload ? [savedWorkspace.parsedUpload.id] : [])).filter((id) =>
          restoredUploads.some((upload) => upload.id === id),
        ),
      );
      setGeneratedDocument(savedWorkspace.generatedDocument || null);
      setFlashcardNotice(savedWorkspace.flashcardNotice || "");
      setYoutubeMessage(savedWorkspace.youtubeMessage || "");
      setShowYoutubeFallback(savedWorkspace.showYoutubeFallback || false);
      setProgress(readSavedProgress(currentUserId));
      setStorageRestored(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUserId]);

  useEffect(() => {
    if (!storageRestored) return;
    window.sessionStorage.setItem(
      IMPORT_WORKSPACE_KEY,
      JSON.stringify({
        ownerUserId: currentUserId,
        title,
        subject,
        notes,
        flashcardCount,
        drafts,
        parsedUpload,
        parsedUploads,
        selectedUploadIds,
        generatedDocument,
        flashcardNotice,
        youtubeMessage,
        showYoutubeFallback,
      }),
    );
  }, [
    drafts,
    currentUserId,
    flashcardCount,
    flashcardNotice,
    generatedDocument,
    notes,
    parsedUpload,
    parsedUploads,
    selectedUploadIds,
    showYoutubeFallback,
    storageRestored,
    subject,
    title,
    youtubeMessage,
  ]);

  useEffect(() => {
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      if (!loading) return;
      event.preventDefault();
      event.returnValue = "An import is still running.";
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [loading]);

  useEffect(() => {
    if (!storageRestored || !progress?.statusUrl || progress.done || progress.failed || resumedStatusUrl.current === progress.statusUrl) return;
    let cancelled = false;
    const statusUrl = progress.statusUrl;
    resumedStatusUrl.current = statusUrl;
    setLoading(true);
    pollImportJob(statusUrl)
      .then((data) => {
        if (cancelled) return;
        applyImportedMaterial(data);
        finishProgress("Imported and stored");
      })
      .catch((data) => {
        if (cancelled) return;
        const payload = data as { error?: { message?: string } };
        setError(payload.error?.message || "Could not finish this import.");
        failProgress("Import failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // This only resumes a job restored from sessionStorage on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, storageRestored, progress?.statusUrl]);

  function clampCount(value: number) {
    return clampImportCount(value);
  }

  function persistProgress(value: ProgressState | null) {
    if (!value) {
      window.sessionStorage.removeItem(IMPORT_PROGRESS_KEY);
      return;
    }
    window.sessionStorage.setItem(IMPORT_PROGRESS_KEY, JSON.stringify({ ...value, ownerUserId: currentUserId, updatedAt: Date.now() }));
  }

  function setProgressState(value: ProgressState | null | ((current: ProgressState | null) => ProgressState | null)) {
    setProgress((current) => {
      const next = typeof value === "function" ? value(current) : value;
      persistProgress(next);
      return next;
    });
  }

  function startProgress(label: string, detail = "Starting...", percent = 5) {
    setProgressState({ ownerUserId: currentUserId, label, detail, percent, startedAt: Date.now() });
  }

  function updateProgress(percent: number, detail?: string) {
    setProgressState((current) =>
      current
        ? {
            ...current,
            percent: Math.max(current.percent, Math.min(99, percent)),
            detail: detail || current.detail,
          }
        : current,
    );
  }

  function finishProgress(detail = "Complete") {
    setProgressState((current) => (current ? { ...current, detail, percent: 100, done: true } : current));
  }

  function failProgress(detail = "Stopped") {
    setProgressState((current) => (current ? { ...current, detail, failed: true } : current));
  }

  function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isImportJobResponse(data: unknown): data is ImportJobResponse {
    return Boolean(
      data &&
        typeof data === "object" &&
        "statusUrl" in data &&
        typeof (data as { statusUrl?: unknown }).statusUrl === "string",
    );
  }

  async function pollImportJob(statusUrl: string, mapPercent: (percent: number) => number = (percent) => percent): Promise<ImportResponse> {
    while (true) {
      const response = await fetch(statusUrl, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ImportJobStatusResponse & ApiErrorPayload;
      if (!response.ok) {
        if (data.error?.code === "IMPORT_JOB_NOT_FOUND") {
          window.sessionStorage.removeItem(IMPORT_PROGRESS_KEY);
          throw { error: { message: "Previous import progress expired. Upload the file again.", code: data.error.code } };
        }
        throw { error: { message: data.error?.message || "Import progress was lost. Start the upload again.", code: data.error?.code } };
      }

      const job = data.job;
      setProgressState((current) =>
        current
          ? {
              ...current,
              label: job.label,
              detail: job.detail,
              percent: Math.max(current.percent, mapPercent(job.percent)),
              statusUrl,
              ownerUserId: currentUserId,
              done: job.status === "completed",
              failed: job.status === "failed",
            }
          : {
              label: job.label,
              detail: job.detail,
              percent: mapPercent(job.percent),
              startedAt: Date.now(),
              statusUrl,
              ownerUserId: currentUserId,
              done: job.status === "completed",
              failed: job.status === "failed",
            },
      );

      if (job.status === "completed" && job.result) return job.result;
      if (job.status === "failed") {
        throw { error: { message: job.error?.message || "Could not import this document.", code: job.error?.code } };
      }
      await wait(1200);
    }
  }

  function uploadFormWithProgress(
    url: string,
    form: FormData,
    file: File,
    options: { label: string; processingDetail: string; overallStart?: number; overallEnd?: number },
  ) {
    const start = options.overallStart ?? 0;
    const end = options.overallEnd ?? 100;
    const mapPercent = (percent: number) => Math.max(0, Math.min(100, Math.round(start + ((end - start) * percent) / 100)));
    startProgress(options.label, "Uploading file", mapPercent(2));
    return new Promise<ImportResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const uploadPercent = Math.max(2, Math.round((event.loaded / event.total) * 70));
        updateProgress(mapPercent(uploadPercent), `Uploading file ${Math.min(100, Math.round((event.loaded / event.total) * 100))}%`);
      };
      xhr.upload.onload = () => updateProgress(mapPercent(72), options.processingDetail);
      xhr.onload = async () => {
        let data: ImportResponse | ImportJobResponse | { error?: { message?: string } };
        try {
          data = JSON.parse(xhr.responseText || "{}") as ImportResponse | ImportJobResponse;
        } catch {
          reject({ error: { message: `The server returned an invalid response while importing ${file.name}.` } });
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          if (isImportJobResponse(data)) {
            setProgressState((current) =>
              current
                ? {
                    ...current,
                    label: data.job.label,
                    detail: data.job.detail,
                    percent: Math.max(current.percent, mapPercent(data.job.percent)),
                    statusUrl: data.statusUrl,
                    ownerUserId: currentUserId,
                  }
                : {
                    label: data.job.label,
                    detail: data.job.detail,
                    percent: mapPercent(data.job.percent),
                    startedAt: Date.now(),
                    statusUrl: data.statusUrl,
                    ownerUserId: currentUserId,
                  },
            );
            try {
              resolve(await pollImportJob(data.statusUrl, mapPercent));
            } catch (error) {
              reject(error);
            }
            return;
          }
          resolve(data as ImportResponse);
        } else {
          reject(data);
        }
      };
      xhr.onerror = () => reject({ error: { message: `Could not upload ${file.name}.` } });
      xhr.send(form);
    });
  }

  function applyImportedMaterial(data: ImportResponse, options: { appendNotes?: boolean } = {}) {
    const upload = { ...data.file, chunks: data.chunks };
    setParsedUpload(upload);
    setParsedUploads((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== upload.id);
      return [...withoutDuplicate, upload];
    });
    setSelectedUploadIds((current) =>
      options.appendNotes ? (current.includes(upload.id) ? current : [...current, upload.id]) : [upload.id],
    );
    setNotes((current) => {
      if (!options.appendNotes) return data.text;
      const section = `--- ${data.file.name} ---\n${data.text}`;
      return current.trim() ? `${current.trim()}\n\n${section}` : section;
    });
    setGeneratedDocument(null);
    setDrafts([]);
    setFlashcardNotice("");
    if (data.file?.warning) setError(data.file.warning);
  }

  function clearImportedMaterial() {
    setParsedUpload(null);
    setParsedUploads([]);
    setSelectedUploadIds([]);
    setGeneratedDocument(null);
    setDrafts([]);
    setFlashcardNotice("");
    window.sessionStorage.removeItem(IMPORT_WORKSPACE_KEY);
  }

  async function readTextFile(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;
    const files = selectedFiles.slice(0, MAX_BATCH_IMPORT_FILES);
    const skippedCount = Math.max(0, selectedFiles.length - files.length);
    setLoading(true);
    setError("");
    setYoutubeMessage("");
    const failures: string[] = [];
    let importedCount = 0;
    try {
      if (files.length > 1 && files.every(isImageUpload)) {
        const form = new FormData();
        for (const file of files) form.append("files", file);
        try {
          const data = await uploadFormWithProgress("/api/import/files", form, files[0], {
            label: `Uploading ${files.length} images`,
            processingDetail: `Upload finished. Analyzing ${files.length} images with AI vision in batches of 5.`,
          });
          applyImportedMaterial(data);
          importedCount = files.length;
          finishProgress(`Imported ${files.length} images as one combined source`);
          setFlashcardNotice(
            `Imported ${files.length} images as one combined source. AI vision analyzes up to 5 images per request.`,
          );
        } catch (data) {
          const payload = data as { error?: { message?: string } };
          failures.push(payload.error?.message || "Could not read these images.");
          setError(payload.error?.message || "Could not import these images.");
          failProgress("Image import failed");
        }
        return;
      }

      for (const [index, file] of files.entries()) {
        const form = new FormData();
        form.set("file", file);
        const overallStart = files.length > 1 ? Math.round((index / files.length) * 100) : 0;
        const overallEnd = files.length > 1 ? Math.round(((index + 1) / files.length) * 100) : 100;
        try {
          const data = await uploadFormWithProgress("/api/import/file", form, file, {
            label: files.length > 1 ? `Uploading file ${index + 1} of ${files.length}` : "Uploading document",
            processingDetail: `Upload finished. Extracting text or analyzing images from ${file.name}.`,
            overallStart,
            overallEnd,
          });
          applyImportedMaterial(data, { appendNotes: files.length > 1 });
          importedCount += 1;
          if (files.length > 1 && index < files.length - 1) {
            setProgressState((current) =>
              current
                ? {
                    ...current,
                    detail: `Imported ${importedCount} of ${files.length}. Continuing with the next file.`,
                    percent: Math.max(current.percent, overallEnd),
                    done: false,
                  }
                : current,
            );
          } else {
            finishProgress(files.length > 1 ? `Imported ${importedCount} of ${files.length}` : "Imported and stored");
          }
        } catch (data) {
          const payload = data as { error?: { message?: string } };
          failures.push(`${file.name}: ${payload.error?.message || "Could not read this file."}`);
          if (files.length > 1 && index < files.length - 1) {
            setProgressState((current) =>
              current
                ? {
                    ...current,
                    detail: `Could not import ${file.name}. Continuing with the next file.`,
                    percent: Math.max(current.percent, overallEnd),
                  }
                : current,
            );
          } else {
            failProgress(`Could not import ${file.name}`);
          }
        }
      }

      const notices = [
        importedCount > 0 && files.length > 1 ? `Imported ${importedCount} file(s). The notes textbox now contains the combined extracted text.` : "",
        skippedCount > 0 ? `Skipped ${skippedCount} file(s); select up to ${MAX_BATCH_IMPORT_FILES} files per batch.` : "",
      ].filter(Boolean);
      if (notices.length > 0) setFlashcardNotice(notices.join(" "));
      if (failures.length > 0) {
        setError(`Some files could not be imported. ${failures.slice(0, 4).join(" ")}`);
      }
      if (importedCount === 0 && failures.length > 0) failProgress("Import failed");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  async function importYoutube() {
    if (!youtubeUrl.trim()) {
      setError("Paste a YouTube URL first.");
      return;
    }
    setLoading(true);
    setError("");
    setYoutubeMessage("");
    setShowYoutubeFallback(false);
    startProgress("Fetching YouTube captions", "Checking available captions", 15);
    try {
      const response = await fetch("/api/import/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim(), language: youtubeLanguage }),
      });
      const data = await response.json();
      if (!response.ok) {
        const message = data.error?.message || NO_TRANSCRIPT_MESSAGE;
        if (data.fallbackRequired) {
          setYoutubeMessage(message);
          setShowYoutubeFallback(true);
        } else {
          setError(message);
        }
        failProgress("Captions unavailable");
        return;
      }
      applyImportedMaterial(data);
      setYoutubeMessage("Available YouTube captions were imported and are ready for note generation.");
      finishProgress("Captions imported");
    } finally {
      setLoading(false);
    }
  }

  async function pasteTranscript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    startProgress("Importing transcript", "Cleaning pasted text", 20);
    try {
      const response = await fetch("/api/import/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: transcriptTitle, transcript: transcriptText }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.message || "Paste a longer transcript.");
        failProgress("Transcript import failed");
        return;
      }
      applyImportedMaterial(data);
      setShowYoutubeFallback(false);
      setYoutubeMessage("Pasted transcript imported and ready for note generation.");
      finishProgress("Transcript imported");
    } finally {
      setLoading(false);
    }
  }

  async function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError("");
    const form = new FormData();
    form.set("file", file);
    form.set("language", mediaLanguage);
    try {
      const data = await uploadFormWithProgress("/api/import/media", form, file, {
        label: "Transcribing media locally",
        processingDetail: "Upload finished. Local Whisper is transcribing the file.",
      });
      applyImportedMaterial(data);
      setShowYoutubeFallback(false);
      setYoutubeMessage("Uploaded media was transcribed locally and is ready for note generation.");
      finishProgress("Media transcribed");
    } catch (data) {
      const payload = data as { error?: { message?: string } };
      setError(payload.error?.message || "Local transcription could not complete.");
      failProgress("Transcription failed");
    } finally {
      setLoading(false);
      event.target.value = "";
    }
  }

  async function generate() {
    setLoading(true);
    setError("");
    setFlashcardNotice("");
    setProgressState(null);
    const batchTotal = Math.max(1, Math.ceil(flashcardCount / FLASHCARD_BATCH_SIZE));
    let nextDrafts: DraftCard[] = [];
    const warnings: string[] = [];
    setGenerationProgress({
      label: "Generating flashcards",
      detail: `Starting batch 1 of ${batchTotal}.`,
      estimate: estimateBatchedGeneration(flashcardCount, FLASHCARD_BATCH_SIZE),
      startedAt: Date.now(),
    });
    try {
      for (let batchIndex = 0; batchIndex < batchTotal && nextDrafts.length < flashcardCount; batchIndex += 1) {
        const requestedCount = Math.min(FLASHCARD_BATCH_SIZE, flashcardCount - nextDrafts.length);
        setGenerationProgress((current) =>
          current
            ? {
                ...current,
                detail: `Batch ${batchIndex + 1} of ${batchTotal}: requesting up to ${requestedCount} flashcards from the AI model.`,
              }
            : current,
        );
        const response = await fetch("/api/ai/flashcards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes, subject, count: requestedCount }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error?.message || `Could not generate flashcard batch ${batchIndex + 1}.`);
          setGenerationProgress(null);
          return;
        }
        if (data.warning) warnings.push(data.warning);
        nextDrafts = appendUniqueDraftCards(nextDrafts, data.cards || [], flashcardCount);
        setGenerationProgress((current) =>
          current
            ? {
                ...current,
                detail: `Batch ${batchIndex + 1} finished. ${nextDrafts.length} of ${flashcardCount} unique flashcards ready.`,
              }
            : current,
        );
      }

      if (nextDrafts.length === 0) {
        setError("The notes did not produce usable flashcards.");
        setGenerationProgress(null);
        return;
      }

      setGenerationProgress((current) =>
        current ? { ...current, detail: "All batches finished. Preparing draft flashcards." } : current,
      );
      setDrafts(nextDrafts);
      setFlashcardNotice(
        warnings[0] || `Created ${nextDrafts.length} flashcards${nextDrafts.length < flashcardCount ? ` out of ${flashcardCount} requested` : ""}.`,
      );
      setGenerationProgress((current) =>
        current ? { ...current, detail: "Flashcards are ready for review.", complete: true } : current,
      );
      window.setTimeout(() => setGenerationProgress(null), 1400);
    } finally {
      setLoading(false);
    }
  }

  function selectedUploads() {
    return parsedUploads.filter((upload) => selectedUploadIds.includes(upload.id));
  }

  function toggleUploadSelection(upload: ParsedUpload) {
    setParsedUpload(upload);
    setSelectedUploadIds((current) =>
      current.includes(upload.id) ? current.filter((id) => id !== upload.id) : [...current, upload.id],
    );
  }

  function selectAllUploads() {
    setSelectedUploadIds(parsedUploads.map((upload) => upload.id));
    if (!parsedUpload && parsedUploads[0]) setParsedUpload(parsedUploads[0]);
  }

  function clearUploadSelection() {
    setSelectedUploadIds([]);
  }

  async function deleteUploads(uploads: ParsedUpload[]) {
    const ids = uploads.map((upload) => upload.id);
    if (ids.length === 0) return;
    setDeletingSources(true);
    setError("");
    const response = await fetch("/api/notes/sources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await response.json().catch(() => ({}));
    setDeletingSources(false);
    if (!response.ok) {
      setError(data.error?.message || "Could not delete the selected sources.");
      return;
    }

    setParsedUploads((current) => current.filter((upload) => !ids.includes(upload.id)));
    setSelectedUploadIds((current) => current.filter((id) => !ids.includes(id)));
    setParsedUpload((current) => {
      if (!current || !ids.includes(current.id)) return current;
      return parsedUploads.find((upload) => !ids.includes(upload.id)) || null;
    });
    setGeneratedDocument(null);
    setDrafts([]);
    setFlashcardNotice(`Deleted ${data.deleted || ids.length} selected source(s).`);
    router.refresh();
  }

  async function generateDocumentNotes(targetUploads?: ParsedUpload[]) {
    const uploads = targetUploads?.length ? targetUploads : selectedUploads().length ? selectedUploads() : parsedUpload ? [parsedUpload] : [];
    if (uploads.length === 0) return;
    setParsedUpload(uploads[0]);
    setSelectedUploadIds(uploads.map((upload) => upload.id));
    setLoading(true);
    setError("");
    setProgressState(null);
    setGenerationProgress({
      label: "Generating notes",
      detail:
        uploads.length > 1
          ? `Combining ${uploads.length} selected sources into one study guide.`
          : "Building notes from the saved imported material.",
      estimate: estimateSingleGeneration(Math.max(1, uploads.length), 8),
      startedAt: Date.now(),
    });
    try {
      const response = await fetch("/api/ai/generate-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          uploads.length > 1
            ? { fileIds: uploads.map((upload) => upload.id), mode: "notes_only", difficulty: "student-friendly detailed" }
            : { fileId: uploads[0].id, mode: "notes_only", difficulty: "student-friendly detailed" },
        ),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "FILE_NOT_FOUND") {
          clearImportedMaterial();
          setError("That imported source is no longer available for this account. Upload it again, then generate notes.");
          setGenerationProgress(null);
          return;
        }
        setError(data.error?.message || "Could not generate notes from the selected source material.");
        setGenerationProgress(null);
        return;
      }
      setGenerationProgress((current) =>
        current ? { ...current, detail: data.generationMode === "fast-source-notes" ? "Notes prepared from saved analysis." : "AI response received. Saving notes to the database." } : current,
      );
      setGeneratedDocument(data);
      setDrafts([]);
      setGenerationProgress((current) => (current ? { ...current, detail: "Notes are saved.", complete: true } : current));
      window.setTimeout(() => setGenerationProgress(null), 1400);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function saveDeck() {
    if (drafts.length === 0) return;
    setLoading(true);
    startProgress("Saving deck", "Creating deck and cards", 10);
    try {
      const deckResponse = await fetch("/api/decks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subject, description: "Generated from imported notes.", tags: ["imported"], color: "#1f9d8a" }),
      });
      const deckData = await deckResponse.json();
      if (!deckResponse.ok) {
        setError(deckData.error?.message || "Could not save deck.");
        failProgress("Deck save failed");
        return;
      }
      for (const [index, card] of drafts.entries()) {
        updateProgress(30 + Math.round(((index + 1) / drafts.length) * 60), `Saving card ${index + 1} of ${drafts.length}`);
        await fetch(`/api/decks/${deckData.deck.id}/cards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(card),
        });
      }
      finishProgress("Deck saved");
      router.push(`/decks/${deckData.deck.id}`);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function importJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    const response = await fetch("/api/decks/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    event.target.value = "";
    if (!response.ok) {
      setError(data.error?.message || "Could not import deck JSON.");
      return;
    }
    router.push(`/decks/${data.deck.id}`);
  }

  const activeSelectedUploads = parsedUploads.filter((upload) => selectedUploadIds.includes(upload.id));
  const allSourcesSelected = parsedUploads.length > 0 && activeSelectedUploads.length === parsedUploads.length;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-4 w-4 text-emerald-700" />
              Import material
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Deck title</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
              </div>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Only upload files you have the right to use. Do not upload copyrighted textbooks, teacher materials, exams, or private documents without permission.
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                className="min-h-80"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Paste notes, lesson material, or textbook excerpts."
              />
            </div>
            <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[160px_1fr] sm:items-end">
              <div className="space-y-2">
                <Label>Flashcards</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={flashcardCount}
                  onChange={(event) => setFlashcardCount(clampCount(Number(event.target.value)))}
                />
              </div>
              <Button onClick={generate} disabled={loading || notes.length < 80}>
                <WandSparkles className="h-4 w-4" />
                {loading ? "Working..." : "Generate flashcards"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary">
                <label>
                  <FileText className="h-4 w-4" />
                  Upload documents/images
                  <input
                    className="hidden"
                    type="file"
                    multiple
                    accept=".txt,.md,.pdf,.docx,.png,.jpg,.jpeg,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg"
                    onChange={readTextFile}
                  />
                </label>
              </Button>
              {parsedUploads.length > 0 || parsedUpload ? (
                <Button onClick={() => generateDocumentNotes()} disabled={loading || (parsedUploads.length > 0 && activeSelectedUploads.length === 0)}>
                  <WandSparkles className="h-4 w-4" />
                  {activeSelectedUploads.length > 1 ? `Generate combined notes (${activeSelectedUploads.length})` : "Generate notes for selected"}
                </Button>
              ) : null}
              <Button asChild variant="secondary">
                <label>
                  Import JSON
                  <input className="hidden" type="file" accept="application/json,.json" onChange={importJson} />
                </label>
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Select up to {MAX_BATCH_IMPORT_FILES} files at once. Supported: PDF, DOCX, TXT, MD, PNG, JPG, JPEG.
            </p>
            {progress ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-emerald-950">{progress.label}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-emerald-800">
                      <Clock3 className="h-3 w-3" />
                      {progress.detail}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-emerald-900">{progress.percent}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white ring-1 ring-emerald-100">
                  <div className="h-full rounded-full bg-emerald-700 transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            ) : null}
            {generationProgress ? <GenerationProgress progress={generationProgress} /> : null}
            {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
            {flashcardNotice ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{flashcardNotice}</p> : null}
            {parsedUploads.length > 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Upload className="h-4 w-4 text-emerald-700" />
                    Imported sources
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                      {activeSelectedUploads.length} selected
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="secondary" onClick={allSourcesSelected ? clearUploadSelection : selectAllUploads}>
                      {allSourcesSelected ? "Clear selection" : "Select all"}
                    </Button>
                    <Button type="button" size="sm" onClick={() => generateDocumentNotes(activeSelectedUploads)} disabled={loading || activeSelectedUploads.length === 0}>
                      <WandSparkles className="h-3.5 w-3.5" />
                      {activeSelectedUploads.length > 1 ? "Make combined notes" : "Make notes"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => deleteUploads(activeSelectedUploads)}
                      disabled={deletingSources || loading || activeSelectedUploads.length === 0}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete selected
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3">
                  {parsedUploads.map((upload) => {
                    const selected = selectedUploadIds.includes(upload.id);
                    return (
                      <div
                        key={upload.id}
                        className={cn(
                          "rounded-md bg-white p-3 text-sm ring-1 transition",
                          selected ? "ring-emerald-300" : "ring-slate-200",
                        )}
                      >
                        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-emerald-600"
                              checked={selected}
                              onChange={() => toggleUploadSelection(upload)}
                              aria-label={`Select ${upload.name}`}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-950">{upload.name}</p>
                              <p className="mt-1 text-xs text-slate-600">
                                {sourceMeta(upload)}
                                {selected ? " / selected" : ""}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button type="button" size="sm" variant={selected ? "primary" : "secondary"} onClick={() => toggleUploadSelection(upload)}>
                              {selected ? "Selected" : "Select"}
                            </Button>
                            <Button type="button" size="sm" onClick={() => generateDocumentNotes([upload])} disabled={loading}>
                              <WandSparkles className="h-3.5 w-3.5" />
                              Notes
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => deleteUploads([upload])} disabled={deletingSources || loading}>
                              <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                              Delete
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {upload.chunks.slice(0, 2).map((chunk) => (
                            <div key={chunk.id} className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 ring-1 ring-slate-100">
                              {chunkDisplayLabel(upload, chunk)}: {cleanChunkPreview(chunk.preview)}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : parsedUpload ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Upload className="h-4 w-4 text-emerald-700" />
                  Parsed {parsedUpload.name}
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {sourceMeta(parsedUpload)} stored for note generation.
                </p>
                <div className="mt-3 grid gap-2">
                  {parsedUpload.chunks.slice(0, 3).map((chunk) => (
                    <div key={chunk.id} className="rounded-md bg-white p-3 text-xs text-slate-600 ring-1 ring-slate-200">
                      {chunkDisplayLabel(parsedUpload, chunk)}: {cleanChunkPreview(chunk.preview)}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {generatedDocument ? (
          <Card>
            <CardHeader>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <CardTitle>{generatedDocument.documentTitle}</CardTitle>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/notes/${generatedDocument.id}`}>Open in Notes</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-7 text-slate-700">{generatedDocument.shortSummary}</p>
              {generatedDocument.notes.map((note) => (
                <div key={note.heading} className="rounded-md bg-slate-50 p-4">
                  <h3 className="font-semibold text-slate-950">{note.heading}</h3>
                  <p className="mt-2 text-sm text-slate-700">{note.explanation}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {note.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {drafts.length ? <FlashcardReviewer cards={drafts} title="Draft flashcards" /> : null}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Save generated cards</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-600">{drafts.length} draft cards ready for review.</p>
            <Button className="mt-4 w-full" onClick={saveDeck} disabled={drafts.length === 0 || loading}>
              <Save className="h-4 w-4" />
              Save as deck
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Video className="h-4 w-4 text-rose-600" />
              YouTube to notes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>YouTube URL</Label>
              <Input value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] xl:grid-cols-1">
              <div className="space-y-2">
                <Label>Caption language</Label>
                <Select value={youtubeLanguage} onChange={(event) => setYoutubeLanguage(event.target.value as TranscriptLanguage)}>
                  {transcriptLanguages.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Button className="self-end" onClick={importYoutube} disabled={loading || !youtubeUrl.trim()}>
                <Captions className="h-4 w-4" />
                Fetch captions
              </Button>
            </div>

            {youtubeMessage ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{youtubeMessage}</div>
            ) : null}

            {showYoutubeFallback ? (
              <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <form className="space-y-3" onSubmit={pasteTranscript}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <ClipboardPaste className="h-4 w-4 text-emerald-700" />
                    Paste transcript manually
                  </div>
                  <Input value={transcriptTitle} onChange={(event) => setTranscriptTitle(event.target.value)} placeholder="Transcript title" />
                  <Textarea
                    className="min-h-36 bg-white"
                    value={transcriptText}
                    onChange={(event) => setTranscriptText(event.target.value)}
                    placeholder="Paste the transcript text here."
                  />
                  <Button type="submit" variant="secondary" disabled={loading || transcriptText.trim().length < 80}>
                    Import pasted transcript
                  </Button>
                </form>

                <div className="space-y-3 border-t border-slate-200 pt-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <FileAudio className="h-4 w-4 text-sky-700" />
                    Upload audio/video file
                  </div>
                  <Select value={mediaLanguage} onChange={(event) => setMediaLanguage(event.target.value as TranscriptLanguage)}>
                    {transcriptLanguages.map((language) => (
                      <option key={language.value} value={language.value}>
                        {language.value === "auto" ? "Auto language" : language.label}
                      </option>
                    ))}
                  </Select>
                  <Button asChild variant="secondary" className="w-full">
                    <label>
                      <FileAudio className="h-4 w-4" />
                      Upload for local Whisper
                      <input className="hidden" type="file" accept="audio/*,video/*" onChange={uploadMedia} />
                    </label>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import coverage</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
              <ImageIcon className="h-4 w-4 text-emerald-700" />
              <span className="text-sm">PNG/JPG, scanned PDFs, and embedded images with AI vision</span>
            </div>
            <div className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
              <Captions className="h-4 w-4 text-rose-600" />
              <span className="text-sm">YouTube captions, selected frames, and local Whisper fallback</span>
            </div>
            <div className="flex items-center gap-3 rounded-md bg-slate-50 p-3">
              <Presentation className="h-4 w-4 text-slate-500" />
              <span className="text-sm">PowerPoint parsing is coming soon</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
