import "server-only";

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { prisma } from "@/lib/db";
import { assertSupportedUpload, parseUploadedFile, parseUploadedImageFiles, type ParseProgress } from "@/lib/document-parser";
import type { ModelMode } from "@/lib/openrouter";

type BufferedUpload = {
  name: string;
  type: string;
  size: number;
  buffer: Buffer;
};

export type ImportJobResult = {
  file: {
    id: string;
    name: string;
    extension: string;
    size: number;
    warning?: string | null;
    imageCount?: number;
  };
  text: string;
  chunks: Array<{ id: string; chunkIndex: number; pageNumber?: number | null; heading?: string | null; preview: string }>;
};

export type ImportJobState = {
  id: string;
  userId: string;
  status: "queued" | "running" | "completed" | "failed";
  label: string;
  detail: string;
  percent: number;
  createdAt: number;
  updatedAt: number;
  result?: ImportJobResult;
  error?: { message: string; code?: string };
};

const jobs = new Map<string, ImportJobState>();
const JOB_TTL_MS = 45 * 60 * 1000;
const JOB_DIR = path.join(process.cwd(), "data", "import-jobs");

function ensureJobDir() {
  if (!existsSync(JOB_DIR)) mkdirSync(JOB_DIR, { recursive: true });
}

function safeJobPath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
  return path.join(JOB_DIR, `${id}.json`);
}

function persistJob(job: ImportJobState) {
  try {
    ensureJobDir();
    const filePath = safeJobPath(job.id);
    if (!filePath) return;
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(job), "utf8");
    renameSync(tempPath, filePath);
  } catch {
    // Import progress should still work in memory if the local status file cannot be written.
  }
}

function readPersistedJob(id: string) {
  try {
    const filePath = safeJobPath(id);
    if (!filePath || !existsSync(filePath)) return null;
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ImportJobState;
    if (!parsed || parsed.id !== id) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deletePersistedJob(id: string) {
  try {
    const filePath = safeJobPath(id);
    if (filePath && existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

function cleanupJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs.entries()) {
    if (job.updatedAt < cutoff) {
      jobs.delete(id);
      deletePersistedJob(id);
    }
  }
  try {
    if (!existsSync(JOB_DIR)) return;
    for (const file of readdirSync(JOB_DIR)) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/i, "");
      const job = readPersistedJob(id);
      if (!job || job.updatedAt < cutoff) deletePersistedJob(id);
    }
  } catch {
    // Cleanup is opportunistic.
  }
}

function updateJob(id: string, update: Partial<Omit<ImportJobState, "id" | "userId" | "createdAt">>) {
  const current = jobs.get(id) || readPersistedJob(id);
  if (!current) return;
  const next = {
    ...current,
    ...update,
    percent: update.percent === undefined ? current.percent : Math.max(current.percent, Math.min(100, Math.round(update.percent))),
    updatedAt: Date.now(),
  };
  jobs.set(id, next);
  persistJob(next);
}

function bufferedFile(upload: BufferedUpload): File {
  return {
    name: upload.name,
    type: upload.type,
    size: upload.size,
    arrayBuffer: async () =>
      upload.buffer.buffer.slice(upload.buffer.byteOffset, upload.buffer.byteOffset + upload.buffer.byteLength) as ArrayBuffer,
    text: async () => upload.buffer.toString("utf8"),
  } as File;
}

function imageBatchName(uploads: BufferedUpload[]) {
  if (uploads.length === 1) return uploads[0].name;
  return `${uploads[0].name} + ${uploads.length - 1} images`;
}

async function runImportJob(
  jobId: string,
  userId: string,
  upload: BufferedUpload,
  options: { modelMode?: ModelMode; manualModel?: string | null },
) {
  try {
    updateJob(jobId, {
      status: "running",
      label: "Extracting document",
      detail: "Starting server-side extraction.",
      percent: 72,
    });
    const file = bufferedFile(upload);
    const parsed = await parseUploadedFile(file, {
      ...options,
      userId,
      onProgress: (progress: ParseProgress) => {
        updateJob(jobId, {
          label: progress.label || "Extracting document",
          detail: progress.detail,
          percent: Math.max(72, Math.min(99, progress.percent)),
        });
      },
    });

    updateJob(jobId, {
      label: "Saving import",
      detail: "Saving extracted text, chunks, and images.",
      percent: 98,
    });

    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        originalName: upload.name,
        mimeType: upload.type || "application/octet-stream",
        extension: parsed.extension,
        size: upload.size,
        status: parsed.warning ? "parsed_with_warning" : "parsed",
        warning: parsed.warning,
        chunks: {
          create: parsed.chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
            slideNumber: chunk.slideNumber,
            startSeconds: chunk.startSeconds,
            endSeconds: chunk.endSeconds,
            heading: chunk.heading,
            rawText: chunk.rawText,
            cleanedText: chunk.cleanedText,
          })),
        },
        images: parsed.images?.length
          ? {
              create: parsed.images.map((image) => ({
                imageIndex: image.imageIndex,
                pageNumber: image.pageNumber,
                timestampSeconds: image.timestampSeconds,
                contentType: image.contentType,
                dataUrl: image.dataUrl,
                altText: image.altText,
              })),
            }
          : undefined,
      },
      include: { chunks: { orderBy: { chunkIndex: "asc" } }, images: { orderBy: { imageIndex: "asc" } } },
    });

    updateJob(jobId, {
      status: "completed",
      label: "Document imported",
      detail: "Imported and stored.",
      percent: 100,
      result: {
        file: {
          id: uploadedFile.id,
          name: uploadedFile.originalName,
          extension: uploadedFile.extension,
          size: uploadedFile.size,
          warning: uploadedFile.warning,
          imageCount: uploadedFile.images.length,
        },
        text: parsed.text,
        chunks: uploadedFile.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          heading: chunk.heading,
          preview: chunk.cleanedText.slice(0, 240),
        })),
      },
    });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      label: "Import failed",
      detail: error instanceof Error ? error.message : "Could not parse this file.",
      percent: 100,
      error: { message: error instanceof Error ? error.message : "Could not parse this file.", code: "PARSE_FAILED" },
    });
  }
}

async function runImageBatchImportJob(
  jobId: string,
  userId: string,
  uploads: BufferedUpload[],
  options: { modelMode?: ModelMode; manualModel?: string | null },
) {
  const batchName = imageBatchName(uploads);
  try {
    updateJob(jobId, {
      status: "running",
      label: "Analyzing images",
      detail: `Starting server-side analysis for ${uploads.length} image(s).`,
      percent: 72,
    });
    const parsed = await parseUploadedImageFiles(uploads.map(bufferedFile), {
      ...options,
      userId,
      onProgress: (progress: ParseProgress) => {
        updateJob(jobId, {
          label: progress.label || "Analyzing images",
          detail: progress.detail,
          percent: Math.max(72, Math.min(99, progress.percent)),
        });
      },
    });

    updateJob(jobId, {
      label: "Saving import",
      detail: "Saving combined image notes, chunks, and source images.",
      percent: 98,
    });

    const uploadedFile = await prisma.uploadedFile.create({
      data: {
        userId,
        originalName: batchName,
        mimeType: "application/studyforge-image-batch",
        extension: parsed.extension,
        size: uploads.reduce((total, upload) => total + upload.size, 0),
        status: parsed.warning ? "parsed_with_warning" : "parsed",
        warning: parsed.warning,
        chunks: {
          create: parsed.chunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            pageNumber: chunk.pageNumber,
            slideNumber: chunk.slideNumber,
            startSeconds: chunk.startSeconds,
            endSeconds: chunk.endSeconds,
            heading: chunk.heading,
            rawText: chunk.rawText,
            cleanedText: chunk.cleanedText,
          })),
        },
        images: parsed.images?.length
          ? {
              create: parsed.images.map((image) => ({
                imageIndex: image.imageIndex,
                pageNumber: image.pageNumber,
                timestampSeconds: image.timestampSeconds,
                contentType: image.contentType,
                dataUrl: image.dataUrl,
                altText: image.altText,
              })),
            }
          : undefined,
      },
      include: { chunks: { orderBy: { chunkIndex: "asc" } }, images: { orderBy: { imageIndex: "asc" } } },
    });

    updateJob(jobId, {
      status: "completed",
      label: "Images imported",
      detail: "Combined image source imported and stored.",
      percent: 100,
      result: {
        file: {
          id: uploadedFile.id,
          name: uploadedFile.originalName,
          extension: uploadedFile.extension,
          size: uploadedFile.size,
          warning: uploadedFile.warning,
          imageCount: uploadedFile.images.length,
        },
        text: parsed.text,
        chunks: uploadedFile.chunks.map((chunk) => ({
          id: chunk.id,
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber,
          heading: chunk.heading,
          preview: chunk.cleanedText.slice(0, 240),
        })),
      },
    });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      label: "Image import failed",
      detail: error instanceof Error ? error.message : "Could not analyze these images.",
      percent: 100,
      error: { message: error instanceof Error ? error.message : "Could not analyze these images.", code: "PARSE_FAILED" },
    });
  }
}

export function startImportJob({
  userId,
  file,
  modelMode,
  manualModel,
}: {
  userId: string;
  file: BufferedUpload;
  modelMode?: ModelMode;
  manualModel?: string | null;
}) {
  cleanupJobs();
  assertSupportedUpload(bufferedFile(file));
  const id = nanoid();
  const now = Date.now();
  const job: ImportJobState = {
    id,
    userId,
    status: "queued",
    label: "Extracting document",
    detail: "Upload finished. Waiting for the server extractor.",
    percent: 72,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  persistJob(job);
  void runImportJob(id, userId, file, { modelMode, manualModel });
  return job;
}

export function startImageBatchImportJob({
  userId,
  files,
  modelMode,
  manualModel,
}: {
  userId: string;
  files: BufferedUpload[];
  modelMode?: ModelMode;
  manualModel?: string | null;
}) {
  cleanupJobs();
  if (files.length === 0) throw new Error("Upload at least one image.");
  for (const file of files) {
    const extension = assertSupportedUpload(bufferedFile(file));
    if (!["png", "jpg", "jpeg"].includes(extension)) throw new Error("Batch image import only supports PNG, JPG, and JPEG files.");
  }
  const id = nanoid();
  const now = Date.now();
  const job: ImportJobState = {
    id,
    userId,
    status: "queued",
    label: "Analyzing images",
    detail: "Upload finished. Waiting for the server image analyzer.",
    percent: 72,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(id, job);
  persistJob(job);
  void runImageBatchImportJob(id, userId, files, { modelMode, manualModel });
  return job;
}

export function getImportJob(id: string, userId: string) {
  cleanupJobs();
  const memoryJob = jobs.get(id);
  const persistedJob = readPersistedJob(id);
  const job =
    persistedJob && (!memoryJob || persistedJob.updatedAt > memoryJob.updatedAt || persistedJob.status === "completed" || persistedJob.status === "failed")
      ? persistedJob
      : memoryJob;
  if (!job || job.userId !== userId) return null;
  jobs.set(id, job);
  return job;
}
