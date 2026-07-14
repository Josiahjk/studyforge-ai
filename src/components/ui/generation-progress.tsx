"use client";

import { CheckCircle2, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type GenerationProgressState = {
  label: string;
  detail: string;
  startedAt: number;
  estimate?: string;
  complete?: boolean;
};

export function GenerationProgress({ progress, className }: { progress: GenerationProgressState; className?: string }) {
  return (
    <div className={cn("rounded-lg border border-emerald-200 bg-emerald-50 p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-emerald-950">{progress.label}</p>
          <p className="mt-1 text-xs leading-5 text-emerald-800">{progress.detail}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-100">
          {progress.complete ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
          {progress.complete ? "Done" : progress.estimate || "Working"}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white ring-1 ring-emerald-100">
        <div
          className={cn(
            "h-full rounded-full bg-emerald-700",
            progress.complete ? "w-full" : "w-2/3 animate-pulse",
          )}
        />
      </div>
    </div>
  );
}
