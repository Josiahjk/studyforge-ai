import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { storeImportedText } from "@/lib/import-store";

const MAX_MEDIA_SIZE = 250 * 1024 * 1024;
const MEDIA_TYPES = /^(audio|video)\//;
const MEDIA_LANGUAGES = new Set(["auto", "en", "ms", "id", "zh"]);

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const form = await request.formData();
  const file = form.get("file");
  const language = String(form.get("language") || "auto");
  if (!(file instanceof File)) return jsonError("Upload an audio or video file you own.", 422);
  if (!MEDIA_LANGUAGES.has(language)) return jsonError("Choose Auto, English, Melayu, Indonesia, or Chinese.", 422, "INVALID_LANGUAGE");
  if (!MEDIA_TYPES.test(file.type || "")) return jsonError("Only audio/video uploads are accepted here.", 422);
  if (file.size > MAX_MEDIA_SIZE) return jsonError("Audio/video uploads are limited to 250 MB.", 413, "FILE_TOO_LARGE");

  const serviceUrl = process.env.TRANSCRIPTION_SERVICE_URL || "http://127.0.0.1:8001";
  try {
    const upstreamForm = new FormData();
    upstreamForm.set("file", file);
    upstreamForm.set("language", language);
    const upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/transcribe`, {
      method: "POST",
      body: upstreamForm,
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok || typeof payload.fullText !== "string") {
      return jsonError(
        payload.detail || "Local transcription service is unavailable. Start services/transcription first.",
        upstream.status || 503,
        "TRANSCRIPTION_FAILED",
      );
    }

    const stored = await storeImportedText({
      userId: user.id,
      originalName: file.name,
      mimeType: file.type,
      extension: "media-transcript",
      size: file.size,
      text: payload.fullText,
      chunks: Array.isArray(payload.segments)
        ? payload.segments.map((segment: { start?: number; end?: number; text?: string }) => ({
            startSeconds: segment.start,
            endSeconds: segment.end,
            text: segment.text || "",
          }))
        : undefined,
      warning: `Local Whisper transcription completed in ${payload.language || "auto"} language mode.`,
    });
    return NextResponse.json({ ...stored, transcription: payload });
  } catch {
    return jsonError(
      "Local transcription service is not running. Start services/transcription with uvicorn, and install FFmpeg.",
      503,
      "TRANSCRIPTION_SERVICE_UNAVAILABLE",
    );
  }
}
