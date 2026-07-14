import "server-only";

import { prisma } from "@/lib/db";
import { chunkText, cleanExtractedText, type ParsedDocumentImage } from "@/lib/document-parser";

export async function storeImportedText({
  userId,
  originalName,
  mimeType,
  extension,
  size,
  text,
  warning,
  chunks: suppliedChunks,
  images,
}: {
  userId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  size: number;
  text: string;
  warning?: string;
  chunks?: Array<{ text: string; startSeconds?: number; endSeconds?: number }>;
  images?: ParsedDocumentImage[];
}) {
  const cleaned = cleanExtractedText(text);
  if (!cleaned) throw new Error("No readable text was found.");
  const chunks = suppliedChunks?.length
    ? chunkText(suppliedChunks.map((chunk) => ({ text: chunk.text, startSeconds: chunk.startSeconds, endSeconds: chunk.endSeconds })))
    : chunkText([{ text: cleaned }]);
  const uploadedFile = await prisma.uploadedFile.create({
    data: {
      userId,
      originalName,
      mimeType,
      extension,
      size,
      status: warning ? "parsed_with_warning" : "parsed",
      warning,
      chunks: {
        create: chunks.map((chunk) => ({
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
      images: images?.length
        ? {
            create: images.map((image) => ({
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

  return {
    file: {
      id: uploadedFile.id,
      name: uploadedFile.originalName,
      extension: uploadedFile.extension,
      size: uploadedFile.size,
      warning: uploadedFile.warning,
      imageCount: uploadedFile.images.length,
    },
    text: cleaned,
    chunks: uploadedFile.chunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      pageNumber: chunk.pageNumber,
      heading: chunk.heading,
      preview: chunk.cleanedText.slice(0, 240),
    })),
  };
}
