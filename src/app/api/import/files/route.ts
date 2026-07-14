import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { startImageBatchImportJob } from "@/lib/import-jobs";
import { type ModelMode, OpenRouterError } from "@/lib/openrouter";

const MAX_BATCH_FILES = 30;

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const form = await request.formData();
  const files = form.getAll("files").filter((item): item is File => item instanceof File).slice(0, MAX_BATCH_FILES);
  if (files.length === 0) return jsonError("Upload one or more images.", 422);

  try {
    const job = startImageBatchImportJob({
      userId: user.id,
      files: await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          buffer: Buffer.from(await file.arrayBuffer()),
        })),
      ),
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
    return jsonError(error instanceof Error ? error.message : "Could not import these images.", 422, "PARSE_FAILED");
  }
}
