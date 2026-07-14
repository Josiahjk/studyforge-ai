import { NextResponse } from "next/server";
import { jsonError, requireApiUser } from "@/lib/api";
import { getImportJob } from "@/lib/import-jobs";

type RouteProps = { params: Promise<{ jobId: string }> };

export async function GET(_request: Request, { params }: RouteProps) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const { jobId } = await params;
  const job = getImportJob(jobId, user.id);
  if (!job) return jsonError("Import job was not found. Start the upload again.", 404, "IMPORT_JOB_NOT_FOUND");

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      label: job.label,
      detail: job.detail,
      percent: job.percent,
      result: job.result,
      error: job.error,
    },
  });
}
