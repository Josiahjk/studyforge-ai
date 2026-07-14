import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { assertSupportedUpload } from "@/lib/document-parser";
import { startImportJob } from "@/lib/import-jobs";
import { type ModelMode, OpenRouterError } from "@/lib/openrouter";

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError("Upload a supported study file.", 422);

  try {
    assertSupportedUpload(file);
    const job = startImportJob({
      userId: user.id,
      file: {
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        buffer: Buffer.from(await file.arrayBuffer()),
      },
      modelMode: (user.setting?.aiModelMode || "auto-free") as ModelMode,
      manualModel: user.setting?.manualModel,
    });
    return NextResponse.json(
      {
        jobId: job.id,
        statusUrl: `/api/import/file/${job.id}`,
        job: {
          id: job.id,
          status: job.status,
          label: job.label,
          detail: job.detail,
          percent: job.percent,
        },
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof OpenRouterError) {
      return jsonError(error.message, error.status, error.code);
    }
    return jsonError(error instanceof Error ? error.message : "Could not parse this file.", 422, "PARSE_FAILED");
  }
}
