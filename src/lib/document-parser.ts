import "server-only";
import { type ModelMode, OpenRouterError, openRouterImageOcr, openRouterVisionAnalysis } from "@/lib/openrouter";

export type ParsedDocumentChunk = {
  chunkIndex: number;
  pageNumber?: number;
  slideNumber?: number;
  startSeconds?: number;
  endSeconds?: number;
  heading?: string;
  rawText: string;
  cleanedText: string;
};

export type ParsedDocument = {
  title: string;
  text: string;
  warning?: string;
  chunks: ParsedDocumentChunk[];
  images?: ParsedDocumentImage[];
};

export type ParsedDocumentImage = {
  imageIndex: number;
  pageNumber?: number;
  timestampSeconds?: number;
  contentType: string;
  dataUrl: string;
  altText?: string;
};

export type ParseProgress = {
  label?: string;
  detail: string;
  percent: number;
};

type ParseOptions = {
  userId?: string;
  modelMode?: ModelMode;
  manualModel?: string | null;
  onProgress?: (progress: ParseProgress) => void;
};

type PdfTextExtraction = {
  text: string;
  pages: Array<{ pageNumber: number; text: string }>;
  totalPages: number;
  truncated: boolean;
  cleanSelectableText: boolean;
};

type VisionBatchResult = {
  label: string;
  text: string;
  images: ParsedDocumentImage[];
};

const MAX_FILE_SIZE = 12 * 1024 * 1024;
const MAX_PDF_PAGES = 30;
const MAX_IMAGE_DIMENSION = 1600;
const DEFAULT_VISION_BATCH_SIZE = 5;
const DOCX_IMAGE_LIMIT = 12;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg"]);
const TEXT_EXTENSIONS = new Set(["txt", "md"]);

export function getUploadExtension(filename: string) {
  return filename.toLowerCase().split(".").pop()?.trim() || "";
}

export function assertSupportedUpload(file: File) {
  const extension = getUploadExtension(file.name);
  const supported =
    extension === "pdf" ||
    extension === "docx" ||
    TEXT_EXTENSIONS.has(extension) ||
    IMAGE_EXTENSIONS.has(extension);
  if (!supported) {
    throw new Error("Unsupported file type. Upload PDF, DOCX, TXT, MD, PNG, JPG, or JPEG.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("Uploads are limited to 12 MB.");
  }
  return extension;
}

function decodeHtml(html: string) {
  return html
    .replace(/<h[1-6][^>]*>/gi, "\n# ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function cleanExtractedText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[\u2022\u25cf\u25aa]/g, "-")
    .replace(/[â€¢â—â–ª]/g, "-")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function estimateTokens(text: string) {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length / 0.75);
}

function joinWarnings(...warnings: Array<string | undefined>) {
  return warnings.filter(Boolean).join(" ") || undefined;
}

function reportProgress(options: ParseOptions | undefined, percent: number, detail: string, label?: string) {
  options?.onProgress?.({ percent: Math.max(0, Math.min(99, Math.round(percent))), detail, label });
}

function imageLabel(image: ParsedDocumentImage) {
  if (image.pageNumber) return `Page ${image.pageNumber}`;
  if (typeof image.timestampSeconds === "number") return `Video frame at ${Math.round(image.timestampSeconds)} seconds`;
  return `Image ${image.imageIndex + 1}`;
}

function resultMentionsImage(text: string, image: ParsedDocumentImage, batchIndex: number) {
  if (image.pageNumber) {
    const actualPagePattern = new RegExp(`\\bpage\\s*${image.pageNumber}\\b`, "i");
    const relativePagePattern = new RegExp(`\\bpage\\s*${batchIndex + 1}\\b`, "i");
    return actualPagePattern.test(text) || relativePagePattern.test(text);
  }
  if (typeof image.timestampSeconds === "number") {
    const rounded = Math.round(image.timestampSeconds);
    return text.toLowerCase().includes(`${rounded} second`) || text.toLowerCase().includes(`${rounded}s`);
  }
  return text.toLowerCase().includes(imageLabel(image).toLowerCase());
}

function missingImagesFromVisionResult(text: string, batch: ParsedDocumentImage[]) {
  if (batch.length <= 1) return [];
  return batch.filter((image, index) => !resultMentionsImage(text, image, index));
}

type CanvasForBuffer = {
  toBuffer(mime: "image/png"): Buffer;
  toBuffer(mime: "image/jpeg", quality?: number): Buffer;
};

function canvasToDataUrl(canvas: CanvasForBuffer) {
  try {
    const buffer = canvas.toBuffer("image/jpeg", 82);
    return { contentType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}` };
  } catch {
    const buffer = canvas.toBuffer("image/png");
    return { contentType: "image/png", dataUrl: `data:image/png;base64,${buffer.toString("base64")}` };
  }
}

async function compressImageBuffer(buffer: Buffer, mimeType: string) {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const source = await loadImage(buffer);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(source.width, source.height));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return canvasToDataUrl(canvas);
  } catch {
    return { contentType: mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
  }
}

async function ocrFallbackDataUrl(dataUrl: string, options?: ParseOptions) {
  return cleanExtractedText(
    await openRouterImageOcr({
      mode: options?.modelMode || "auto-free",
      manualModel: options?.manualModel,
      userId: options?.userId,
      dataUrl,
    }),
  );
}

export async function extractTextFromPdf(buffer: Buffer, maxPages = MAX_PDF_PAGES): Promise<PdfTextExtraction> {
  const pdfParse = (await import("pdf-parse")).default;
  const pages: Array<{ pageNumber: number; text: string }> = [];
  let pageNumber = 0;
  const result = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      pageNumber += 1;
      if (pageNumber > maxPages) return "";
      const content = await pageData.getTextContent();
      const text = content.items
        .map((item: { str?: string }) => item.str || "")
        .join(" ");
      pages.push({ pageNumber, text });
      return text;
    },
  });
  const totalPages = result.numpages || pages.length;
  const text = cleanExtractedText(result.text || pages.map((page) => page.text).join("\n\n"));
  const selectablePages = pages.filter((page) => cleanExtractedText(page.text).length >= 80).length;
  const averageChars = text.length / Math.max(1, pages.length);
  const cleanSelectableText =
    text.length >= Math.max(350, pages.length * 450) &&
    selectablePages >= Math.max(1, Math.ceil(pages.length * 0.75)) &&
    averageChars >= 350;

  return {
    text,
    pages,
    totalPages,
    truncated: totalPages > maxPages,
    cleanSelectableText,
  };
}

export async function renderPdfPagesToImages(buffer: Buffer, options?: ParseOptions) {
  const [{ getDocument }, { createCanvas }] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("@napi-rs/canvas"),
  ]);
  const loadingTask = getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const pageLimit = Math.min(totalPages, MAX_PDF_PAGES);
  const images: ParsedDocumentImage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      reportProgress(
        options,
        78 + ((pageNumber - 1) / Math.max(1, pageLimit)) * 12,
        `Rendering PDF page ${pageNumber} of ${pageLimit} for AI vision.`,
        "Rendering page images",
      );
      const page = await pdf.getPage(pageNumber);
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, MAX_IMAGE_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
        const viewport = page.getViewport({ scale: Math.max(0.8, scale) });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: context as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const rendered = canvasToDataUrl(canvas);
        images.push({
          imageIndex: images.length,
          pageNumber,
          contentType: rendered.contentType,
          dataUrl: rendered.dataUrl,
          altText: `Rendered page ${pageNumber} from the uploaded PDF.`,
        });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }

  return {
    totalPages,
    images,
    warning: totalPages > MAX_PDF_PAGES ? `Only the first ${MAX_PDF_PAGES} PDF page(s) were analyzed for safety.` : undefined,
  };
}

export async function sendImagesToOpenRouterVision(
  images: ParsedDocumentImage[],
  options?: ParseOptions,
  promptPrefix?: string,
): Promise<VisionBatchResult[]> {
  const results: VisionBatchResult[] = [];
  let batchSize = DEFAULT_VISION_BATCH_SIZE;
  let index = 0;

  while (index < images.length) {
    const batch = images.slice(index, index + batchSize);
    const labels = batch.map(imageLabel).join(", ");
    reportProgress(
      options,
      90 + (index / Math.max(1, images.length)) * 7,
      `Analyzing ${labels} with AI vision.`,
      "Analyzing pages with AI vision",
    );

    try {
      const text = await openRouterVisionAnalysis({
        mode: options?.modelMode || "auto-free",
        manualModel: options?.manualModel,
        userId: options?.userId,
        maxTokens: Math.min(7000, 1800 + batch.length * 1200),
        prompt: `${promptPrefix || "You are an AI study assistant."}

Analyze the uploaded document page images like a study tutor.

For each labeled page or image, write study-guide material in this structure:
Use the exact supplied label, such as "Page 5". Do not restart numbering at Page 1 for later batches.
Topic: clear topic name from the material
Study-note paragraph: explain the concept like a human tutor. Connect the labels, diagram parts, formulas, or table values into meaning.
Key study points:
- write useful facts in complete study language
- expand short labels instead of only copying them
Diagram or visual walkthrough:
- if there is a diagram, graph, table, chart, formula, screenshot, or labeled drawing, explain what each important part means and how to read it

Rules:
- Create real study notes, not raw OCR and not meta commentary.
- Do not answer with a safety classification only. If the image is safe, ignore that and analyze the learning content.
- Do not write phrases like "This page explains", "important extracted text", "quiz ideas", "flashcard ideas", or "review this topic".
- Use topic headings from the material, not just the page number.
- For a graph, explain axes, curve steepness, plateau/final amount, and conclusion.
- For a process, explain the sequence and what changes at each step.
- For an anatomy/label diagram, explain each important part and its function.
- Preserve page labels only as separators so the app can link notes back to the source image.
- If something is blurry or unreadable, say which label and part is unclear.`,
        images: batch.map((image) => ({
          label: imageLabel(image),
          dataUrl: image.dataUrl,
        })),
      });
      results.push({ label: labels, text, images: batch });

      const missingImages = missingImagesFromVisionResult(text, batch);
      for (const missingImage of missingImages) {
        const retryLabel = imageLabel(missingImage);
        reportProgress(
          options,
          90 + (index / Math.max(1, images.length)) * 7,
          `The first vision pass skipped ${retryLabel}. Analyzing it by itself.`,
          "Analyzing missed page",
        );
        const retryText = await openRouterVisionAnalysis({
          mode: options?.modelMode || "auto-free",
          manualModel: options?.manualModel,
          userId: options?.userId,
          maxTokens: 2600,
          prompt: `${promptPrefix || "You are an AI study assistant."}

Analyze only ${retryLabel}. Use the exact heading "${retryLabel}".

Create detailed study notes from this page image:
- extract the important text
- explain diagrams, labels, tables, graphs, formulas, and visual layout
- write study-guide paragraphs and useful study points
- do not answer with only "User Safety: safe" or any safety-only response
- avoid meta phrases like "this page explains" or "important extracted text"
- if a label is unreadable, name only that unclear label.`,
          images: [{ label: retryLabel, dataUrl: missingImage.dataUrl }],
        });
        results.push({ label: retryLabel, text: retryText, images: [missingImage] });
      }
      index += batch.length;
    } catch (error) {
      const aiError = error as OpenRouterError;
      if (aiError.code === "VISION_BATCH_REJECTED" && batchSize > 1) {
        batchSize = batchSize > 2 ? 2 : 1;
        reportProgress(
          options,
          90 + (index / Math.max(1, images.length)) * 7,
          `Retrying ${labels} with ${batchSize} image(s) per request.`,
          "Retrying smaller image batch",
        );
        continue;
      }
      throw aiError;
    }
  }

  return results;
}

function cleanVisionAnalysisText(text: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return cleanExtractedText(text)
    .replace(new RegExp(`^AI vision analysis for\\s+${escapedLabel}\\s*:?\\s*`, "i"), "")
    .replace(/^AI vision analysis for\s+(?:image|page)\s+\d+\s*:?\s*/i, "")
    .replace(/^Page\s+\d+(?:\s*,\s*Page\s+\d+)+\s+/i, "")
    .replace(/^Page\s+\d+\s+Topic\s*:/i, "Topic:")
    .replace(/^image\s+\d+\s+topic\s*:/i, "Topic:")
    .trim();
}

export function combineBatchNotes(batches: VisionBatchResult[]) {
  const parts = batches.map((batch) => {
    const cleaned = cleanVisionAnalysisText(batch.text, batch.label);
    const sourceLabel = batch.images.length === 1 && batch.images[0].pageNumber ? `${batch.label}\n` : "";
    return {
      pageNumber: batch.images.length === 1 ? batch.images[0].pageNumber : undefined,
      text: `${sourceLabel}${cleaned}`.trim(),
    };
  });
  return {
    text: cleanExtractedText(parts.map((part) => part.text).join("\n\n")),
    parts,
  };
}

export function chunkText(parts: Array<{ text: string; pageNumber?: number; slideNumber?: number; startSeconds?: number; endSeconds?: number }>) {
  const chunks: ParsedDocumentChunk[] = [];
  const maxTokens = 1200;
  const overlapWords = 120;

  for (const part of parts) {
    const cleaned = cleanExtractedText(part.text);
    if (!cleaned) continue;

    const headingMatch = cleaned.match(/^(?:#\s*)?(.{6,90})\n/);
    const heading = headingMatch?.[1]?.trim();
    const paragraphs = cleaned.split(/\n{2,}/);
    let buffer = "";

    for (const paragraph of paragraphs) {
      const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
      if (estimateTokens(next) > maxTokens && buffer) {
        chunks.push({
          chunkIndex: chunks.length,
          pageNumber: part.pageNumber,
          slideNumber: part.slideNumber,
          startSeconds: part.startSeconds,
          endSeconds: part.endSeconds,
          heading,
          rawText: buffer,
          cleanedText: cleanExtractedText(buffer),
        });
        const overlap = buffer.split(/\s+/).slice(-overlapWords).join(" ");
        buffer = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
      } else {
        buffer = next;
      }
    }

    if (buffer.trim()) {
      chunks.push({
        chunkIndex: chunks.length,
        pageNumber: part.pageNumber,
        slideNumber: part.slideNumber,
        startSeconds: part.startSeconds,
        endSeconds: part.endSeconds,
        heading,
        rawText: buffer,
        cleanedText: cleanExtractedText(buffer),
      });
    }
  }

  return chunks;
}

async function parsePdf(
  file: File,
  options?: ParseOptions,
): Promise<ParsedDocument> {
  reportProgress(options, 74, "Reading the PDF text layer.", "Extracting document");
  const buffer = Buffer.from(await file.arrayBuffer());
  const extraction = await extractTextFromPdf(buffer);
  const warnings = [
    extraction.truncated ? `Only the first ${MAX_PDF_PAGES} PDF page(s) were imported for safety.` : undefined,
  ];

  if (extraction.cleanSelectableText) {
    return {
      title: file.name.replace(/\.[^.]+$/, ""),
      text: extraction.text,
      warning: joinWarnings(...warnings),
      chunks: chunkText(extraction.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }))),
      images: [],
    };
  }

  reportProgress(
    options,
    77,
    "Selectable text is weak or visual-heavy. Rendering pages for AI vision instead of OCR.",
    "Rendering page images",
  );
  const rendered = await renderPdfPagesToImages(buffer, options);
  warnings.push(rendered.warning);
  if (rendered.images.length === 0) {
    return {
      title: file.name.replace(/\.[^.]+$/, ""),
      text: extraction.text,
      warning: joinWarnings(...warnings, "The PDF pages could not be rendered for AI vision."),
      chunks: chunkText(extraction.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }))),
      images: [],
    };
  }

  try {
    const batches = await sendImagesToOpenRouterVision(rendered.images, options);
    const combined = combineBatchNotes(batches);
    const text = cleanExtractedText([extraction.text.length > 80 ? `Selectable text found:\n${extraction.text}` : "", combined.text].join("\n\n"));
    return {
      title: file.name.replace(/\.[^.]+$/, ""),
      text,
      warning: joinWarnings(...warnings, "AI vision analyzed the rendered PDF page images."),
      chunks: chunkText([...combined.parts, ...extraction.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text }))]),
      images: rendered.images,
    };
  } catch (error) {
    const aiError = error as OpenRouterError;
    if (aiError.status === 429 || aiError.code === "NO_FREE_VISION_MODELS" || aiError.code === "INVALID_API_KEY") throw aiError;
    const fallbackTexts: Array<{ pageNumber?: number; text: string }> = [];
    for (const image of rendered.images.slice(0, 6)) {
      try {
        const text = await ocrFallbackDataUrl(image.dataUrl, options);
        if (text) fallbackTexts.push({ pageNumber: image.pageNumber, text: `Fallback text extraction for ${imageLabel(image)}:\n${text}` });
      } catch {
        // OCR fallback is optional and should not hide direct text.
      }
    }
    const text = cleanExtractedText([extraction.text, ...fallbackTexts.map((part) => part.text)].join("\n\n"));
    return {
      title: file.name.replace(/\.[^.]+$/, ""),
      text,
      warning: joinWarnings(...warnings, `AI vision failed: ${aiError.message}`, fallbackTexts.length ? "Fallback text extraction was used." : undefined),
      chunks: chunkText([...extraction.pages.map((page) => ({ pageNumber: page.pageNumber, text: page.text })), ...fallbackTexts]),
      images: rendered.images,
    };
  }
}

async function parseDocx(
  file: File,
  options?: ParseOptions,
): Promise<ParsedDocument> {
  reportProgress(options, 74, "Reading DOCX text and embedded images.", "Extracting document");
  const mammoth = await import("mammoth");
  const buffer = Buffer.from(await file.arrayBuffer());
  const embeddedImages: Array<{ contentType: string; base64: string }> = [];
  const html = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.readAsBase64String();
        embeddedImages.push({ contentType: image.contentType, base64 });
        return { src: "" };
      }),
    },
  );
  const baseText = cleanExtractedText(decodeHtml(html.value));
  const images: ParsedDocumentImage[] = [];
  for (const image of embeddedImages.slice(0, DOCX_IMAGE_LIMIT)) {
    const compressed = await compressImageBuffer(Buffer.from(image.base64, "base64"), image.contentType);
    images.push({
      imageIndex: images.length,
      contentType: compressed.contentType,
      dataUrl: compressed.dataUrl,
      altText: `Embedded image ${images.length + 1} from ${file.name}.`,
    });
  }

  let visionText = "";
  let visionWarning: string | undefined;
  if (images.length) {
    try {
      const batches = await sendImagesToOpenRouterVision(images, options, "You are analyzing embedded images from a DOCX study document.");
      visionText = combineBatchNotes(batches).text;
      visionWarning = `${images.length} DOCX embedded image(s) were analyzed with AI vision.`;
    } catch (error) {
      const aiError = error as OpenRouterError;
      if (!baseText || aiError.status === 429 || aiError.code === "INVALID_API_KEY") throw aiError;
      visionWarning = `Embedded image vision analysis failed: ${aiError.message}`;
    }
  }

  const text = cleanExtractedText([baseText, visionText ? `Embedded image AI vision analysis:\n${visionText}` : ""].join("\n\n"));
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    text,
    warning: joinWarnings(
      html.messages.length ? "Some DOCX formatting was simplified during import." : undefined,
      embeddedImages.length > DOCX_IMAGE_LIMIT ? `Only the first ${DOCX_IMAGE_LIMIT} embedded image(s) were analyzed.` : undefined,
      visionWarning,
    ),
    chunks: chunkText([{ text }]),
    images,
  };
}

async function parseText(file: File): Promise<ParsedDocument> {
  const text = cleanExtractedText(await file.text());
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    text,
    chunks: chunkText([{ text }]),
  };
}

async function parseImage(
  file: File,
  options?: ParseOptions,
): Promise<ParsedDocument> {
  reportProgress(options, 78, "Preparing image for AI vision.", "Analyzing image");
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");
  const compressed = await compressImageBuffer(buffer, mimeType);
  const image: ParsedDocumentImage = {
    imageIndex: 0,
    contentType: compressed.contentType,
    dataUrl: compressed.dataUrl,
    altText: `Uploaded image ${file.name}.`,
  };
  const batches = await sendImagesToOpenRouterVision([image], options, "You are analyzing an uploaded study image.");
  const text = combineBatchNotes(batches).text;
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    text,
    warning: "Uploaded image was analyzed with AI vision.",
    chunks: chunkText([{ text }]),
    images: [image],
  };
}

export async function parseUploadedImageFiles(
  files: File[],
  options?: ParseOptions,
): Promise<ParsedDocument & { extension: string }> {
  if (files.length === 0) throw new Error("Upload at least one image.");
  const images: ParsedDocumentImage[] = [];
  reportProgress(options, 74, `Preparing ${files.length} image(s) for AI vision.`, "Analyzing images");

  for (const [index, file] of files.entries()) {
    const extension = assertSupportedUpload(file);
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error("Batch image import only supports PNG, JPG, and JPEG files.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || (extension === "png" ? "image/png" : "image/jpeg");
    const compressed = await compressImageBuffer(buffer, mimeType);
    images.push({
      imageIndex: index,
      pageNumber: index + 1,
      contentType: compressed.contentType,
      dataUrl: compressed.dataUrl,
      altText: `Uploaded image ${file.name}.`,
    });
    reportProgress(
      options,
      74 + ((index + 1) / Math.max(1, files.length)) * 12,
      `Prepared image ${index + 1} of ${files.length}.`,
      "Preparing images",
    );
  }

  const batches = await sendImagesToOpenRouterVision(
    images,
    options,
    `You are analyzing ${files.length} uploaded study images as one combined source.`,
  );
  const combined = combineBatchNotes(batches);
  const title = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, "") : `${files[0].name} + ${files.length - 1} images`;
  const text = combined.text;
  if (!text.trim()) throw new Error("No readable study material was found in these images.");

  return {
    title,
    text,
    warning: `${files.length} uploaded image(s) were analyzed with AI vision in batches of up to ${DEFAULT_VISION_BATCH_SIZE}.`,
    chunks: chunkText(combined.parts),
    images,
    extension: "images",
  };
}

export async function parseUploadedFile(
  file: File,
  options?: ParseOptions,
): Promise<ParsedDocument & { extension: string }> {
  const extension = assertSupportedUpload(file);
  let parsed: ParsedDocument;
  reportProgress(options, 72, `Accepted ${file.name}. Preparing extraction.`, "Extracting document");

  if (extension === "pdf") parsed = await parsePdf(file, options);
  else if (extension === "docx") parsed = await parseDocx(file, options);
  else if (TEXT_EXTENSIONS.has(extension)) parsed = await parseText(file);
  else parsed = await parseImage(file, options);

  reportProgress(options, 97, "Cleaning extracted study material and creating chunks.", "Extracting document");

  if (!parsed.text.trim()) {
    throw new Error(
      extension === "pdf"
        ? "Could not extract readable study material from this PDF."
        : "No readable study material was found in this file.",
    );
  }

  return { ...parsed, extension };
}
