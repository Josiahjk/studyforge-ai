"use client";

import { ReactNode, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { playFlipSound } from "@/lib/answer-sounds";

export type ReviewFlashcard = {
  type: "qa" | "mcq" | "cloze";
  question: string;
  answer: string;
  clozeText?: string | null;
  options?: string[];
  correctOption?: number | null;
  explanation?: string | null;
  difficulty: "easy" | "medium" | "hard";
  tags: string[];
};

type ReviewRating = "good" | "bad";

type FlashcardReviewerProps = {
  cards: ReviewFlashcard[];
  title?: string;
  actions?: ReactNode;
};

function cardTypeLabel(type: ReviewFlashcard["type"]) {
  if (type === "mcq") return "Multiple choice";
  if (type === "cloze") return "Cloze";
  return "Question";
}

function difficultyTone(difficulty: ReviewFlashcard["difficulty"]) {
  if (difficulty === "easy") return "bg-emerald-50 text-emerald-800 ring-emerald-100";
  if (difficulty === "hard") return "bg-rose-50 text-rose-800 ring-rose-100";
  return "bg-amber-50 text-amber-800 ring-amber-100";
}

export function FlashcardReviewer({ cards, title = "Generated flashcards", actions }: FlashcardReviewerProps) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [ratings, setRatings] = useState<Record<number, ReviewRating>>({});

  const card = cards[index];
  const reviewedCount = useMemo(() => Object.keys(ratings).length, [ratings]);
  const goodCount = useMemo(() => Object.values(ratings).filter((rating) => rating === "good").length, [ratings]);
  const badCount = reviewedCount - goodCount;

  function flipCard() {
    playFlipSound();
    setFlipped((current) => !current);
  }

  function rateCard(rating: ReviewRating) {
    setRatings((current) => ({ ...current, [index]: rating }));
  }

  function moveTo(nextIndex: number) {
    if (nextIndex < 0 || nextIndex >= cards.length) return;
    setIndex(nextIndex);
    setFlipped(false);
  }

  function nextCard() {
    if (index >= cards.length - 1) {
      setCompleted(true);
      setFlipped(false);
      return;
    }
    moveTo(index + 1);
  }

  function restart() {
    setIndex(0);
    setFlipped(false);
    setCompleted(false);
    setRatings({});
  }

  if (!cards.length) return null;

  if (completed) {
    return (
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors duration-300">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-semibold text-slate-950">{title}</p>
            <p className="text-sm text-slate-600">Review complete.</p>
          </div>
          {actions}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium uppercase tracking-normal text-slate-500">Cards</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{cards.length}</p>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-medium uppercase tracking-normal text-emerald-700">Good</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-900">{goodCount}</p>
          </div>
          <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-medium uppercase tracking-normal text-rose-700">Bad</p>
            <p className="mt-1 text-2xl font-semibold text-rose-900">{badCount}</p>
          </div>
        </div>
        <Button variant="secondary" onClick={restart}>
          <RotateCcw className="h-4 w-4" />
          Review again
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors duration-300">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="text-sm font-semibold text-slate-950">{title}</p>
          <p className="text-sm text-slate-600">
            Card {index + 1} of {cards.length}
            {reviewedCount ? ` / ${reviewedCount} rated` : ""}
          </p>
        </div>
        {actions}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div
          className="h-full rounded-full bg-[var(--accent-color)] transition-all duration-500"
          style={{ width: `${((index + 1) / cards.length) * 100}%` }}
        />
      </div>

      <div style={{ perspective: "1200px" }}>
        <button
          type="button"
          onClick={flipCard}
          className="group block w-full text-left outline-none"
          aria-label={flipped ? "Show question side" : "Show answer side"}
        >
          <div
            className="relative min-h-[330px] rounded-xl transition-transform duration-500 ease-out group-focus-visible:ring-2 group-focus-visible:ring-[var(--accent-color)]"
            style={{
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <div
              className="absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="mb-5 flex flex-wrap gap-2">
                <Badge>{cardTypeLabel(card.type)}</Badge>
                <Badge className={difficultyTone(card.difficulty)}>{card.difficulty}</Badge>
                {card.tags.slice(0, 3).map((tag) => (
                  <Badge key={tag} className="bg-slate-100 text-slate-700 ring-slate-200">
                    {tag}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-1 items-center justify-center">
                <h3 className="max-w-3xl text-center text-xl font-semibold leading-8 text-slate-950 sm:text-2xl">{card.question}</h3>
              </div>
              <p className="mt-5 text-center text-sm text-slate-500">Flip to reveal the answer.</p>
            </div>

            <div
              className="absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <div className="mb-5 flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-emerald-100 text-emerald-900 ring-emerald-200">Answer</Badge>
                  {ratings[index] ? (
                    <Badge className={ratings[index] === "good" ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"}>
                      {ratings[index]}
                    </Badge>
                  ) : null}
                </div>
                <Check className="h-5 w-5 text-emerald-700" />
              </div>
              <div className="flex flex-1 flex-col justify-center gap-4">
                <p className="text-lg font-semibold leading-8 text-slate-950">{card.answer}</p>
                {card.explanation ? <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{card.explanation}</p> : null}
                {card.clozeText ? <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{card.clozeText}</p> : null}
                {card.options?.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {card.options.map((option, optionIndex) => (
                      <div
                        key={`${option}-${optionIndex}`}
                        className={`rounded-md border p-2 text-sm ${
                          optionIndex === card.correctOption
                            ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                            : "border-slate-200 bg-slate-50 text-slate-700"
                        }`}
                      >
                        {option}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => moveTo(index - 1)} disabled={index === 0}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          <Button variant="secondary" onClick={flipCard}>
            <RotateCcw className="h-4 w-4" />
            {flipped ? "Question" : "Flip"}
          </Button>
        </div>

        {flipped ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant={ratings[index] === "bad" ? "danger" : "secondary"}
              onClick={() => rateCard("bad")}
              className={ratings[index] === "bad" ? "" : "border-rose-200 text-rose-700 hover:bg-rose-50"}
            >
              <ThumbsDown className="h-4 w-4" />
              Bad
            </Button>
            <Button
              variant={ratings[index] === "good" ? "primary" : "secondary"}
              onClick={() => rateCard("good")}
              className={ratings[index] === "good" ? "" : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"}
            >
              <ThumbsUp className="h-4 w-4" />
              Good
            </Button>
            <Button onClick={nextCard}>
              {index >= cards.length - 1 ? "Finish" : "Next"}
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Rate yourself after revealing the answer.</p>
        )}
      </div>
    </section>
  );
}
