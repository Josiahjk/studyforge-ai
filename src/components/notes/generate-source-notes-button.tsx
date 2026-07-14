"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { estimateSingleGeneration } from "@/lib/generation-estimates";

export function GenerateSourceNotesButton({
  fileId,
  label = "Generate Notes",
  size,
  variant,
}: {
  fileId: string;
  label?: string;
  size?: "sm" | "icon";
  variant?: "secondary" | "ghost";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);

  async function generate() {
    setLoading(true);
    setError("");
    setProgress({
      label: "Generating notes",
      detail: "Building notes from the saved imported material.",
      estimate: estimateSingleGeneration(1, 8),
      startedAt: Date.now(),
    });
    const response = await fetch("/api/ai/generate-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileId, mode: "notes_only", difficulty: "student-friendly detailed" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setLoading(false);
      setProgress(null);
      setError(data.error?.message || "Could not generate notes from this source.");
      return;
    }
    setProgress((current) =>
      current
        ? {
            ...current,
            detail: data.generationMode === "fast-source-notes" ? "Notes prepared from saved analysis. Opening the notes page." : "Notes saved. Opening the notes page.",
            complete: true,
          }
        : current,
    );
    setLoading(false);
    router.push(`/notes/${data.id}`);
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <Button onClick={generate} disabled={loading} size={size} variant={variant}>
        <WandSparkles className="h-4 w-4" />
        {loading ? "Generating..." : label}
      </Button>
      {error ? <p className="max-w-xs rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</p> : null}
      {progress ? <GenerationProgress progress={progress} className="max-w-sm" /> : null}
    </div>
  );
}
