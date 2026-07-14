import "server-only";

import { prisma } from "@/lib/db";

export type ModelMode = "auto-free" | "best-free" | "manual-free";

export type FreeModel = {
  id: string;
  name: string;
  contextLength: number;
};

export type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string | OpenRouterContentPart[];
};

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
};

type CompletionPayload = {
  error?: { message?: string };
  choices?: Array<{ message?: { content?: string | null } }>;
};

export class OpenRouterError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "OPENROUTER_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let freeModelCache: { expiresAt: number; models: FreeModel[] } | null = null;
let freeVisionModelCache: { expiresAt: number; models: FreeModel[] } | null = null;

const MODEL_CACHE_MS = 5 * 60 * 1000;
const TEXT_REQUEST_TIMEOUT_MS = 90 * 1000;
const VISION_REQUEST_TIMEOUT_MS = 90 * 1000;
const OPENROUTER_MINUTE_LIMIT = 12;
const OPENROUTER_USER_DAILY_LIMIT = 475;
const OPENROUTER_GLOBAL_DAILY_LIMIT = 950;
const OPENROUTER_REQUEST_ENDPOINT = "openrouter:request";
const OPENROUTER_USER_DAILY_ENDPOINT = "openrouter:user-day";
const OPENROUTER_GLOBAL_DAILY_ENDPOINT = "openrouter:global-day";

function hasApiKey() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function isStrictFreeOnly() {
  return process.env.OPENROUTER_FREE_ONLY?.trim().toLowerCase() === "true";
}

function isAllowedFreeModelId(id: string) {
  const normalized = id.toLowerCase();
  return normalized === "openrouter/free" || normalized.endsWith(":free");
}

function isZero(value: string | undefined) {
  if (!value) return true;
  return Number(value) === 0;
}

function isFreeModel(model: OpenRouterModel) {
  if (isStrictFreeOnly()) return isAllowedFreeModelId(model.id);
  const modality = model.architecture?.modality?.toLowerCase() || "";
  const supportsText = !modality || modality.includes("text") || modality.includes("input");
  const zeroPriced =
    isZero(model.pricing?.prompt) &&
    isZero(model.pricing?.completion) &&
    isZero(model.pricing?.request) &&
    isZero(model.pricing?.image);
  return supportsText && (model.id.includes(":free") || zeroPriced);
}

function isFreeVisionModel(model: OpenRouterModel) {
  const modalities = model.architecture?.input_modalities || [];
  const modality = model.architecture?.modality?.toLowerCase() || "";
  return isFreeModel(model) && (modalities.includes("image") || modality.includes("image"));
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new OpenRouterError("The free AI model took too long to respond. Try a smaller batch or try again.", 504, "AI_TIMEOUT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readOpenRouterPayload(response: Response) {
  const raw = await response.text();
  try {
    return JSON.parse(raw) as CompletionPayload;
  } catch {
    return { error: { message: raw.trim() } } as CompletionPayload;
  }
}

function openRouterHeaders() {
  return {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
    "X-OpenRouter-Title": "AI Learning Website",
  };
}

function messageIncludes(message: string, patterns: string[]) {
  const normalized = message.toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

function classifyOpenRouterError(status: number, message: string, kind: "text" | "vision") {
  if (status === 401) {
    return new OpenRouterError("The OpenRouter API key is invalid or missing access.", 401, "INVALID_API_KEY");
  }
  if (status === 429) {
    return new OpenRouterError("OpenRouter rate limited this request. Wait and try again, or reduce the batch size.", 429, "RATE_LIMITED");
  }
  if (kind === "vision") {
    if (
      status === 413 ||
      messageIncludes(message, ["payload", "too large", "maximum", "max", "context", "tokens", "image size", "too many images"])
    ) {
      return new OpenRouterError("OpenRouter rejected this image batch as too large.", status || 400, "VISION_BATCH_REJECTED");
    }
    if (
      status === 400 ||
      status === 404 ||
      messageIncludes(message, ["image", "vision", "modality", "modalities", "unsupported", "does not support"])
    ) {
      return new OpenRouterError(message || "The selected free model does not support image input.", status || 400, "VISION_INPUT_UNSUPPORTED");
    }
  }
  if (status === 400 || status === 404) {
    return new OpenRouterError("The selected free model is unavailable for this request.", status, "MODEL_UNAVAILABLE");
  }
  return new OpenRouterError(message || "OpenRouter could not complete this request.", status || 500, "OPENROUTER_REQUEST_FAILED");
}

async function enforceOpenRouterUsage(userId?: string) {
  if (!userId) return;

  const minuteStart = new Date(Date.now() - 60 * 1000);
  const dayStart = startOfToday();
  const [minuteCount, userDailyCount, globalDailyCount] = await Promise.all([
    prisma.aiRequestLog.count({
      where: { userId, endpoint: OPENROUTER_REQUEST_ENDPOINT, createdAt: { gte: minuteStart } },
    }),
    prisma.aiRequestLog.count({
      where: { userId, endpoint: OPENROUTER_USER_DAILY_ENDPOINT, createdAt: { gte: dayStart } },
    }),
    prisma.aiRequestLog.count({
      where: { endpoint: OPENROUTER_GLOBAL_DAILY_ENDPOINT, createdAt: { gte: dayStart } },
    }),
  ]);

  if (minuteCount >= OPENROUTER_MINUTE_LIMIT) {
    throw new OpenRouterError("OpenRouter request limit reached: 12 requests per minute. Wait a minute and try again.", 429, "APP_RATE_LIMITED");
  }
  if (userDailyCount >= OPENROUTER_USER_DAILY_LIMIT) {
    throw new OpenRouterError("Daily OpenRouter free-model limit reached for this account: 475 requests/day.", 429, "USER_DAILY_LIMITED");
  }
  if (globalDailyCount >= OPENROUTER_GLOBAL_DAILY_LIMIT) {
    throw new OpenRouterError("Daily OpenRouter free-model limit reached for this app: 950 requests/day.", 429, "GLOBAL_DAILY_LIMITED");
  }

  await prisma.aiRequestLog.createMany({
    data: [
      { userId, endpoint: OPENROUTER_REQUEST_ENDPOINT },
      { userId, endpoint: OPENROUTER_USER_DAILY_ENDPOINT },
      { userId, endpoint: OPENROUTER_GLOBAL_DAILY_ENDPOINT },
    ],
  });
}

async function requestOpenRouterCompletion({
  body,
  timeoutMs,
  userId,
  kind,
}: {
  body: Record<string, unknown>;
  timeoutMs: number;
  userId?: string;
  kind: "text" | "vision";
}) {
  let lastError: OpenRouterError | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await enforceOpenRouterUsage(userId);
    const response = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: openRouterHeaders(),
        body: JSON.stringify(body),
      },
      timeoutMs,
    );
    const payload = await readOpenRouterPayload(response);
    const message = payload.error?.message || "";

    if (response.ok) return payload;

    const error = classifyOpenRouterError(response.status, message, kind);
    if (error.code === "RATE_LIMITED" || error.code === "INVALID_API_KEY" || error.code.startsWith("VISION_")) {
      throw error;
    }
    lastError = error;
    if (response.status >= 500 && attempt < 2) {
      await wait(1000 * 2 ** attempt);
      continue;
    }
    throw error;
  }
  throw lastError || new OpenRouterError("OpenRouter could not complete this request.", 500, "OPENROUTER_REQUEST_FAILED");
}

export async function fetchFreeModels(): Promise<FreeModel[]> {
  if (freeModelCache && freeModelCache.expiresAt > Date.now()) return freeModelCache.models;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new OpenRouterError("Could not load OpenRouter models right now.", response.status, "MODELS_UNAVAILABLE");
  }
  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  const models = (payload.data || [])
    .filter(isFreeModel)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length || 0,
    }))
    .sort((a, b) => b.contextLength - a.contextLength || a.name.localeCompare(b.name));
  freeModelCache = { expiresAt: Date.now() + MODEL_CACHE_MS, models };
  return models;
}

export async function fetchFreeVisionModels(): Promise<FreeModel[]> {
  if (freeVisionModelCache && freeVisionModelCache.expiresAt > Date.now()) return freeVisionModelCache.models;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    next: { revalidate: 300 },
  });
  if (!response.ok) {
    throw new OpenRouterError("Could not load OpenRouter models right now.", response.status, "MODELS_UNAVAILABLE");
  }
  const payload = (await response.json()) as { data?: OpenRouterModel[] };
  const models = (payload.data || [])
    .filter(isFreeVisionModel)
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
      contextLength: model.context_length || 0,
    }))
    .filter((model) => visionModelScore(model) >= 0)
    .sort((a, b) => visionModelScore(b) - visionModelScore(a) || b.contextLength - a.contextLength || a.name.localeCompare(b.name));
  freeVisionModelCache = { expiresAt: Date.now() + MODEL_CACHE_MS, models };
  return models;
}

export async function enforceAiCooldown(userId: string, endpoint: string, seconds = 8) {
  const last = await prisma.aiRequestLog.findFirst({
    where: { userId, endpoint },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < seconds * 1000) {
    throw new OpenRouterError("Please wait a few seconds before sending another AI request.", 429, "COOLDOWN");
  }
  await prisma.aiRequestLog.create({ data: { userId, endpoint } });
}

async function resolveModel(mode: ModelMode, manualModel?: string | null) {
  if (mode === "auto-free") return "openrouter/free";

  const freeModels = await fetchFreeModels();
  if (freeModels.length === 0) {
    throw new OpenRouterError("No free OpenRouter models are available right now.", 503, "NO_FREE_MODELS");
  }

  if (mode === "manual-free") {
    if (manualModel && isStrictFreeOnly() && !isAllowedFreeModelId(manualModel)) {
      throw new OpenRouterError("OPENROUTER_FREE_ONLY is enabled, so choose a model ending in :free.", 400, "MODEL_UNAVAILABLE");
    }
    if (manualModel === "openrouter/free") return manualModel;
    const selected = freeModels.find((model) => model.id === manualModel);
    if (!selected) {
      throw new OpenRouterError("Choose an available free model before sending this request.", 400, "MODEL_UNAVAILABLE");
    }
    return selected.id;
  }

  return freeModels[0].id;
}

async function resolveVisionModels(mode: ModelMode, manualModel?: string | null) {
  if (mode === "manual-free") {
    if (manualModel && isStrictFreeOnly() && !isAllowedFreeModelId(manualModel)) {
      throw new OpenRouterError("OPENROUTER_FREE_ONLY is enabled, so choose a vision model ending in :free.", 400, "VISION_MODEL_UNAVAILABLE");
    }
    if (manualModel === "openrouter/free") return [manualModel];
    const freeModels = await fetchFreeVisionModels();
    const selected = freeModels.find((model) => model.id === manualModel);
    if (!selected) {
      throw new OpenRouterError("Choose an available free vision model before uploading images.", 400, "VISION_MODEL_UNAVAILABLE");
    }
    return [selected.id];
  }

  const freeModels = await fetchFreeVisionModels();
  const fallbackModels = freeModels.map((model) => model.id).filter((id) => id !== "openrouter/free");
  return fallbackModels.length ? [...fallbackModels, "openrouter/free"] : ["openrouter/free"];
}

function visionModelScore(model: FreeModel) {
  const id = model.id.toLowerCase();
  const name = model.name.toLowerCase();
  if (id.includes("safety") || name.includes("safety") || id.includes("moderation") || name.includes("moderation")) return -1000;
  if (id.includes("lyria") || name.includes("lyria")) return -900;
  if (id === "openrouter/free") return -800;
  if (id.includes("nemotron-nano-12b-v2-vl")) return 100;
  if (id.includes("nex-n2-pro")) return 90;
  if (id.includes("vl")) return 80;
  if (id.includes("vision")) return 70;
  if (id.includes("gemma")) return 60;
  return 0;
}

function isSafetyOnlyVisionResponse(text: string) {
  const normalized = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^ai vision analysis for image \d+\s*:\s*/i, "")
    .replace(/[*_`#>|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalized) return true;

  const safetyOnlyPatterns = [
    /^user safety\s*:?\s*safe\.?$/,
    /^content safety\s*:?\s*safe\.?$/,
    /^safety\s*:?\s*safe\.?$/,
    /^safe\.?$/,
    /^the image is safe\.?$/,
    /^this image is safe\.?$/,
    /^no unsafe content detected\.?$/,
  ];
  if (safetyOnlyPatterns.some((pattern) => pattern.test(normalized))) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  const hasSafetyLanguage = /\b(safe|safety|unsafe|moderation|policy|content)\b/.test(normalized);
  const hasStudyLanguage =
    /\b(topic|study|note|diagram|graph|table|formula|label|concept|definition|explain|summary|economics|microeconomics|macroeconomics|scarcity|resource|question|answer)\b/.test(
      normalized,
    );

  return words.length <= 18 && hasSafetyLanguage && !hasStudyLanguage;
}

export async function openRouterChat({
  mode,
  manualModel,
  messages,
  temperature = 0.4,
  userId,
}: {
  mode: ModelMode;
  manualModel?: string | null;
  messages: OpenRouterMessage[];
  temperature?: number;
  userId?: string;
}) {
  if (!hasApiKey()) {
    throw new OpenRouterError("Add OPENROUTER_API_KEY to .env to use AI features.", 401, "MISSING_API_KEY");
  }

  const model = await resolveModel(mode, manualModel);
  const payload = await requestOpenRouterCompletion({
    userId,
    kind: "text",
    timeoutMs: TEXT_REQUEST_TIMEOUT_MS,
    body: {
      model,
      messages,
      temperature,
    },
  });

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new OpenRouterError("The model returned an empty response.", 502, "EMPTY_AI_RESPONSE");
  }
  return content;
}

export async function openRouterVisionAnalysis({
  mode,
  manualModel,
  prompt,
  images,
  maxTokens = 2200,
  temperature = 0.1,
  userId,
}: {
  mode: ModelMode;
  manualModel?: string | null;
  prompt: string;
  images: Array<{ label: string; dataUrl: string }>;
  maxTokens?: number;
  temperature?: number;
  userId?: string;
}) {
  if (!hasApiKey()) {
    throw new OpenRouterError("Add OPENROUTER_API_KEY to .env to use AI vision.", 401, "MISSING_API_KEY");
  }
  if (images.length === 0) {
    throw new OpenRouterError("No images were provided for AI vision analysis.", 422, "NO_IMAGES");
  }

  const models = await resolveVisionModels(mode, manualModel);
  let lastError: OpenRouterError | null = null;

  for (const model of models) {
    const content: OpenRouterContentPart[] = [
      { type: "text", text: prompt },
      ...images.flatMap((image) => [
        { type: "text" as const, text: image.label },
        { type: "image_url" as const, image_url: { url: image.dataUrl } },
      ]),
    ];

    try {
      const payload = await requestOpenRouterCompletion({
        userId,
        kind: "vision",
        timeoutMs: VISION_REQUEST_TIMEOUT_MS,
        body: {
          model,
          max_tokens: maxTokens,
          temperature,
          messages: [{ role: "user", content }],
        },
      });
      const text = payload.choices?.[0]?.message?.content?.trim();
      if (text) {
        if (isSafetyOnlyVisionResponse(text)) {
          lastError = new OpenRouterError(
            "The free vision model returned only a safety check instead of reading the study image.",
            502,
            "VISION_EMPTY_ANALYSIS",
          );
          continue;
        }
        return text;
      }
      lastError = new OpenRouterError("The free vision model returned an empty response.", 502, "EMPTY_AI_RESPONSE");
    } catch (error) {
      const aiError = error as OpenRouterError;
      if (aiError.code === "RATE_LIMITED" || aiError.code === "INVALID_API_KEY" || aiError.code === "VISION_BATCH_REJECTED") {
        throw aiError;
      }
      lastError = aiError;
      continue;
    }
  }

  if (lastError?.code === "VISION_INPUT_UNSUPPORTED" || lastError?.code === "VISION_MODEL_UNAVAILABLE") {
    throw new OpenRouterError("No free OpenRouter vision model is available for image analysis right now.", 503, "NO_FREE_VISION_MODELS");
  }
  if (lastError?.code === "VISION_EMPTY_ANALYSIS") {
    throw new OpenRouterError(
      "The free vision model could not read this image content. Try a clearer image or choose another free vision model.",
      502,
      "VISION_EMPTY_ANALYSIS",
    );
  }
  throw lastError || new OpenRouterError("No free OpenRouter vision model is available for image analysis right now.", 503, "NO_FREE_VISION_MODELS");
}

export async function openRouterImageOcr({
  mode,
  manualModel,
  dataUrl,
  userId,
}: {
  mode: ModelMode;
  manualModel?: string | null;
  dataUrl: string;
  userId?: string;
}) {
  const text = await openRouterVisionAnalysis({
    mode,
    manualModel,
    userId,
    maxTokens: 1200,
    temperature: 0,
    prompt:
      "Extract all readable study text from this image. Return plain text only. Preserve line breaks when useful. If no text is readable, say: NO_READABLE_TEXT.",
    images: [{ label: "Image for OCR fallback", dataUrl }],
  });
  if (!text || text === "NO_READABLE_TEXT") {
    throw new OpenRouterError("No readable text was found in this image.", 422, "EMPTY_OCR");
  }
  return text;
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const start = Math.min(
    ...[candidate.indexOf("{"), candidate.indexOf("[")].filter((index) => index >= 0),
  );
  if (!Number.isFinite(start)) return candidate;
  const trimmed = candidate.slice(start);
  const lastObject = trimmed.lastIndexOf("}");
  const lastArray = trimmed.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  return end >= 0 ? trimmed.slice(0, end + 1) : trimmed;
}

export async function generateJson<T>({
  mode,
  manualModel,
  messages,
  repairInstruction,
  userId,
}: {
  mode: ModelMode;
  manualModel?: string | null;
  messages: OpenRouterMessage[];
  repairInstruction: string;
  userId?: string;
}): Promise<T> {
  const first = await openRouterChat({ mode, manualModel, messages, temperature: 0.25, userId });
  try {
    return JSON.parse(extractJson(first)) as T;
  } catch {
    const repaired = await openRouterChat({
      mode,
      manualModel,
      temperature: 0,
      userId,
      messages: [
        { role: "system", content: "Return valid JSON only. Do not include markdown or commentary." },
        {
          role: "user",
          content: `${repairInstruction}\n\nInvalid response:\n${first}`,
        },
      ],
    });
    try {
      return JSON.parse(extractJson(repaired)) as T;
    } catch {
      throw new OpenRouterError("The model returned malformed JSON. Try a smaller note sample or another free model.", 502, "MALFORMED_JSON");
    }
  }
}
