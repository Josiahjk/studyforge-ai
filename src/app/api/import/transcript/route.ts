import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { storeImportedText } from "@/lib/import-store";

const transcriptSchema = z.object({
  title: z.string().min(1).max(160).default("Pasted transcript"),
  transcript: z.string().min(80).max(120000),
});

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = transcriptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Paste a longer transcript.", 422);

  const stored = await storeImportedText({
    userId: user.id,
    originalName: parsed.data.title,
    mimeType: "text/plain",
    extension: "transcript",
    size: parsed.data.transcript.length,
    text: parsed.data.transcript,
  });

  return NextResponse.json(stored);
}
