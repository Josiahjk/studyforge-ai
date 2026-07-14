import { NextResponse } from "next/server";
import { z } from "zod";
import { YoutubeTranscript } from "youtube-transcript";
import { jsonError, requireApiUser } from "@/lib/api";
import { combineBatchNotes, sendImagesToOpenRouterVision, type ParsedDocumentImage } from "@/lib/document-parser";
import { storeImportedText } from "@/lib/import-store";
import { type ModelMode, OpenRouterError } from "@/lib/openrouter";

const youtubeSchema = z.object({
  url: z.string().url(),
  language: z.enum(["auto", "en", "ms", "id", "zh"]).default("auto"),
});

type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

type YoutubeServicePayload = {
  language?: string;
  fullText?: string;
  segments?: TranscriptSegment[];
  frames?: Array<{ timestamp: number; dataUrl: string; contentType?: string }>;
  warning?: string;
};

function extractVideoId(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.replace("/", "");
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v") || url;
    const shorts = parsed.pathname.match(/\/shorts\/([^/?]+)/);
    if (shorts) return shorts[1];
  } catch {
    return url;
  }
  return url;
}

function visualHeavy(text: string) {
  return /\b(slide|slides|diagram|formula|equation|chart|graph|table|whiteboard|code|coding|tutorial|screen|screenshot|solve|math|physics|chemistry|biology|anatomy|drawing|sketch|map|flowchart|presentation)\b/i.test(
    text,
  );
}

async function fetchTitle(url: string) {
  try {
    const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, {
      cache: "no-store",
    });
    if (!response.ok) return "";
    const payload = (await response.json()) as { title?: string };
    return payload.title || "";
  } catch {
    return "";
  }
}

function captionLanguageAttempts(language: string) {
  return language === "auto" ? [undefined, "en", "ms", "id", "zh"] : [language];
}

async function fetchCaptions(videoId: string, language: string) {
  for (const attempt of captionLanguageAttempts(language)) {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId, attempt ? { lang: attempt } : undefined);
      const normalized = segments
        .map((segment) => ({
          start: segment.offset / 1000,
          end: (segment.offset + segment.duration) / 1000,
          text: segment.text,
        }))
        .filter((segment) => segment.text.trim());
      const fullText = normalized.map((segment) => segment.text).join(" ");
      if (fullText.trim()) return { language: attempt || "auto", segments: normalized, fullText };
    } catch {
      // Try the next caption language.
    }
  }
  return null;
}

function transcriptChunks(segments: TranscriptSegment[]) {
  const chunks: Array<{ text: string; startSeconds?: number; endSeconds?: number }> = [];
  let current: TranscriptSegment[] = [];
  let wordCount = 0;

  for (const segment of segments) {
    current.push(segment);
    wordCount += segment.text.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 350) {
      chunks.push({
        startSeconds: current[0].start,
        endSeconds: current[current.length - 1].end,
        text: current.map((item) => `[${Math.round(item.start)}s] ${item.text}`).join(" "),
      });
      current = [];
      wordCount = 0;
    }
  }

  if (current.length) {
    chunks.push({
      startSeconds: current[0].start,
      endSeconds: current[current.length - 1].end,
      text: current.map((item) => `[${Math.round(item.start)}s] ${item.text}`).join(" "),
    });
  }

  return chunks;
}

async function callYoutubeService({
  url,
  language,
  transcribe,
  frames,
}: {
  url: string;
  language: string;
  transcribe: boolean;
  frames: boolean;
}) {
  const serviceUrl = process.env.TRANSCRIPTION_SERVICE_URL || "http://127.0.0.1:8001";
  const form = new FormData();
  form.set("url", url);
  form.set("language", language);
  form.set("transcribe", transcribe ? "true" : "false");
  form.set("frames", frames ? "true" : "false");
  const upstream = await fetch(`${serviceUrl.replace(/\/$/, "")}/youtube`, {
    method: "POST",
    body: form,
  });
  const payload = (await upstream.json().catch(() => ({}))) as YoutubeServicePayload & { detail?: string };
  if (!upstream.ok) {
    throw new OpenRouterError(
      payload.detail || "Local YouTube processing service is unavailable. Start services/transcription and install FFmpeg plus yt-dlp.",
      upstream.status || 503,
      "YOUTUBE_LOCAL_PROCESSING_FAILED",
    );
  }
  return payload;
}

async function analyzeFrames({
  frames,
  userId,
  mode,
  manualModel,
}: {
  frames: YoutubeServicePayload["frames"];
  userId: string;
  mode: ModelMode;
  manualModel?: string | null;
}) {
  const images: ParsedDocumentImage[] = (frames || []).slice(0, 24).map((frame, index) => ({
    imageIndex: index,
    timestampSeconds: frame.timestamp,
    contentType: frame.contentType || "image/jpeg",
    dataUrl: frame.dataUrl,
    altText: `YouTube frame at ${Math.round(frame.timestamp)} seconds.`,
  }));
  if (!images.length) return { text: "", images };
  const batches = await sendImagesToOpenRouterVision(images, {
    userId,
    modelMode: mode,
    manualModel,
  }, "You are analyzing selected frames from a YouTube study video. Connect visual content to the transcript when possible.");
  return { text: combineBatchNotes(batches).text, images };
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = youtubeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Paste a valid YouTube URL.", 422);

  const videoId = extractVideoId(parsed.data.url);
  const title = await fetchTitle(parsed.data.url);
  const mode = (user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = user.setting?.manualModel;

  try {
    const captions = await fetchCaptions(videoId, parsed.data.language);
    if (captions) {
      const shouldSampleFrames = visualHeavy(`${title}\n${captions.fullText.slice(0, 6000)}`);
      let frameText = "";
      let images: ParsedDocumentImage[] = [];
      let frameWarning = "";
      if (shouldSampleFrames) {
        const servicePayload = await callYoutubeService({
          url: parsed.data.url,
          language: parsed.data.language,
          transcribe: false,
          frames: true,
        });
        const analyzed = await analyzeFrames({
          frames: servicePayload.frames,
          userId: user.id,
          mode,
          manualModel,
        });
        frameText = analyzed.text;
        images = analyzed.images;
        frameWarning = analyzed.images.length ? ` ${analyzed.images.length} visual frame(s) were analyzed with AI vision.` : "";
      }

      const fullText = [captions.fullText, frameText ? `Selected frame AI vision analysis:\n${frameText}` : ""].filter(Boolean).join("\n\n");
      const stored = await storeImportedText({
        userId: user.id,
        originalName: title ? `YouTube - ${title}` : `YouTube transcript ${videoId}`,
        mimeType: "text/youtube-transcript",
        extension: "youtube",
        size: fullText.length,
        text: fullText,
        chunks: [
          ...transcriptChunks(captions.segments),
          ...(frameText ? [{ text: `Selected frame AI vision analysis:\n${frameText}` }] : []),
        ],
        images,
        warning: `Transcript imported from available YouTube captions (${captions.language}).${frameWarning}`,
      });
      return NextResponse.json({
        ...stored,
        visualMode: shouldSampleFrames ? "transcript-plus-selected-frames" : "transcript-first",
        segments: captions.segments,
      });
    }

    const servicePayload = await callYoutubeService({
      url: parsed.data.url,
      language: parsed.data.language,
      transcribe: true,
      frames: true,
    });
    const segments = servicePayload.segments || [];
    const fullTranscript = servicePayload.fullText || segments.map((segment) => segment.text).join(" ");
    if (!fullTranscript.trim()) return jsonError("Local transcription finished but no speech was detected.", 422, "EMPTY_TRANSCRIPT");

    const analyzed = await analyzeFrames({
      frames: servicePayload.frames,
      userId: user.id,
      mode,
      manualModel,
    });
    const fullText = [fullTranscript, analyzed.text ? `Selected frame AI vision analysis:\n${analyzed.text}` : ""].filter(Boolean).join("\n\n");
    const stored = await storeImportedText({
      userId: user.id,
      originalName: title ? `YouTube - ${title}` : `YouTube local transcription ${videoId}`,
      mimeType: "text/youtube-local-transcript",
      extension: "youtube",
      size: fullText.length,
      text: fullText,
      chunks: [
        ...transcriptChunks(segments),
        ...(analyzed.text ? [{ text: `Selected frame AI vision analysis:\n${analyzed.text}` }] : []),
      ],
      images: analyzed.images,
      warning: `No YouTube captions were found. Audio was transcribed locally${servicePayload.language ? ` (${servicePayload.language})` : ""}; ${analyzed.images.length} selected frame(s) were analyzed.`,
    });
    return NextResponse.json({
      ...stored,
      visualMode: "local-transcript-plus-selected-frames",
      segments,
      serviceWarning: servicePayload.warning,
    });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "YOUTUBE_IMPORT_FAILED");
  }
}
