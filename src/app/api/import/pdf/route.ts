import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { parseUploadedFile } from "@/lib/document-parser";

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Upload a PDF file.", 422);
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return jsonError("Only PDF files are supported here.", 422);
  }
  if (file.size > 8 * 1024 * 1024) return jsonError("PDF uploads are limited to 8 MB.", 413, "FILE_TOO_LARGE");

  try {
    const parsed = await parseUploadedFile(file);
    return NextResponse.json({ text: parsed.text, warning: parsed.warning });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not extract text from this PDF.", 422, "PDF_PARSE_FAILED");
  }
}
