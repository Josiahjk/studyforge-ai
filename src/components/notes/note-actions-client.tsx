"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Brain, Layers3, MessageSquare, Save, WandSparkles } from "lucide-react";
import { FlashcardReviewer, type ReviewFlashcard } from "@/components/flashcards/flashcard-reviewer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { estimateBatchedGeneration } from "@/lib/generation-estimates";

type GeneratedCard = ReviewFlashcard;

const FLASHCARD_BATCH_SIZE = 10;

function appendUniqueCards(existing: GeneratedCard[], incoming: GeneratedCard[], limit: number) {
  const seen = new Set(existing.map((card) => card.question.trim().toLowerCase()));
  const output = [...existing];
  for (const card of incoming) {
    const key = card.question.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(card);
    if (output.length >= limit) break;
  }
  return output;
}

export function NoteActionsClient({
  noteId,
  title,
  sourceNotes,
}: {
  noteId: string;
  title: string;
  sourceNotes: string;
}) {
  const router = useRouter();
  const [cards, setCards] = useState<GeneratedCard[]>([]);
  const [answer, setAnswer] = useState("");
  const [question, setQuestion] = useState("");
  const [flashcardCount, setFlashcardCount] = useState(10);
  const [loading, setLoading] = useState<"flashcards" | "save" | "ask" | "">("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressState | null>(null);

  function clampCount(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(50, Math.max(1, Math.round(value)));
  }

  async function generateFlashcards() {
    setLoading("flashcards");
    setError("");
    setNotice("");
    const batchTotal = Math.max(1, Math.ceil(flashcardCount / FLASHCARD_BATCH_SIZE));
    let nextCards: GeneratedCard[] = [];
    const warnings: string[] = [];
    setGenerationProgress({
      label: "Generating flashcards",
      detail: `Starting batch 1 of ${batchTotal}.`,
      estimate: estimateBatchedGeneration(flashcardCount, FLASHCARD_BATCH_SIZE),
      startedAt: Date.now(),
    });

    for (let batchIndex = 0; batchIndex < batchTotal && nextCards.length < flashcardCount; batchIndex += 1) {
      const requestedCount = Math.min(FLASHCARD_BATCH_SIZE, flashcardCount - nextCards.length);
      setGenerationProgress((current) =>
        current
          ? {
              ...current,
              detail: `Batch ${batchIndex + 1} of ${batchTotal}: requesting up to ${requestedCount} flashcards from the AI model.`,
            }
          : current,
      );
      const response = await fetch("/api/ai/flashcards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: sourceNotes, subject: title, count: requestedCount }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoading("");
        setGenerationProgress(null);
        setError(data.error?.message || `Could not generate flashcard batch ${batchIndex + 1}.`);
        return;
      }
      if (data.warning) warnings.push(data.warning);
      nextCards = appendUniqueCards(nextCards, data.cards || [], flashcardCount);
      setGenerationProgress((current) =>
        current
          ? {
              ...current,
              detail: `Batch ${batchIndex + 1} finished. ${nextCards.length} of ${flashcardCount} unique flashcards ready.`,
            }
          : current,
      );
    }

    if (nextCards.length === 0) {
      setLoading("");
      setGenerationProgress(null);
      setError("The notes did not produce usable flashcards.");
      return;
    }

    setGenerationProgress((current) =>
      current ? { ...current, detail: "All batches finished. Preparing flashcards for review." } : current,
    );
    setCards(nextCards);
    setNotice(
      warnings[0] || `Created ${nextCards.length} flashcards${nextCards.length < flashcardCount ? ` out of ${flashcardCount} requested` : ""}.`,
    );
    setGenerationProgress((current) =>
      current ? { ...current, detail: "Flashcards are ready for review.", complete: true } : current,
    );
    setLoading("");
    window.setTimeout(() => setGenerationProgress(null), 1400);
  }

  async function saveDeck() {
    if (cards.length === 0) return;
    setLoading("save");
    setError("");
    const deckResponse = await fetch("/api/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${title} Flashcards`.slice(0, 120),
        subject: title.slice(0, 80) || "Notes",
        description: "Generated from saved notes.",
        tags: ["notes"],
        color: "#1f9d8a",
      }),
    });
    const deckData = await deckResponse.json();
    if (!deckResponse.ok) {
      setLoading("");
      setError(deckData.error?.message || "Could not save a deck from these flashcards.");
      return;
    }
    for (const card of cards) {
      const response = await fetch(`/api/decks/${deckData.deck.id}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(card),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setLoading("");
        setError(data.error?.message || "Some flashcards could not be saved.");
        return;
      }
    }
    setLoading("");
    router.push(`/decks/${deckData.deck.id}`);
    router.refresh();
  }

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading("ask");
    setError("");
    setAnswer("");
    const response = await fetch(`/api/notes/${noteId}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();
    setLoading("");
    if (!response.ok) {
      setError(data.error?.message || "Could not answer from these notes.");
      return;
    }
    setAnswer(data.answer);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-emerald-700" />
          Study tools
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary">
            <Link href={`/notes/${noteId}/quiz`}>
              <Layers3 className="h-4 w-4" />
              Make multiple-choice quiz
            </Link>
          </Button>
        </div>

        <div className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[160px_1fr] sm:items-end">
          <div className="space-y-2">
            <Label>Flashcards</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={flashcardCount}
              onChange={(event) => setFlashcardCount(clampCount(Number(event.target.value)))}
            />
          </div>
          <Button onClick={generateFlashcards} disabled={loading === "flashcards" || sourceNotes.length < 80}>
            <WandSparkles className="h-4 w-4" />
            {loading === "flashcards" ? "Generating..." : "Make flashcards"}
          </Button>
        </div>

        <form onSubmit={ask} className="space-y-2">
          <Input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a question about these notes" />
          <Button variant="secondary" disabled={loading === "ask" || question.trim().length < 2}>
            <MessageSquare className="h-4 w-4" />
            {loading === "ask" ? "Thinking..." : "Ask notes"}
          </Button>
        </form>

        {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
        {notice ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{notice}</p> : null}
        {generationProgress ? <GenerationProgress progress={generationProgress} /> : null}
        {answer ? <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-7 text-slate-700">{answer}</p> : null}

        {cards.length ? (
          <FlashcardReviewer
            cards={cards}
            actions={
              <Button size="sm" onClick={saveDeck} disabled={loading === "save"}>
                <Save className="h-4 w-4" />
                {loading === "save" ? "Saving..." : "Save as deck"}
              </Button>
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
