"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { playFlipSound } from "@/lib/answer-sounds";

type StudyCard = {
  id: string;
  type: string;
  question: string;
  answer: string;
  explanation: string | null;
  difficulty: string;
  optionsJson: string | null;
};

export function StudyClient({ deckId, deckTitle, cards }: { deckId: string; deckTitle: string; cards: StudyCard[] }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState("");
  const current = cards[index];

  const options = useMemo(() => {
    if (!current?.optionsJson) return [];
    try {
      return JSON.parse(current.optionsJson) as string[];
    } catch {
      return [];
    }
  }, [current]);

  async function rate(rating: "again" | "hard" | "good" | "easy") {
    if (!current) return;
    const response = await fetch(`/api/study/${deckId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cardId: current.id, rating }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error?.message || "Could not save review.");
      return;
    }
    setDone((value) => value + 1);
    setRevealed(false);
    setIndex((value) => value + 1);
  }

  function flipCard() {
    playFlipSound();
    setRevealed((value) => !value);
  }

  if (cards.length === 0 || !current) {
    return (
      <Card className="mx-auto max-w-2xl">
        <CardContent className="pt-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-700" />
          <h2 className="mt-4 text-xl font-bold">Review complete</h2>
          <p className="mt-2 text-sm text-slate-600">{done} cards reviewed from {deckTitle}.</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button asChild variant="secondary">
              <Link href={`/decks/${deckId}`}>Deck</Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between text-sm text-slate-600">
        <span>
          Card {index + 1} of {cards.length}
        </span>
        <span>{done} reviewed</span>
      </div>
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-emerald-700" style={{ width: `${((index + 1) / cards.length) * 100}%` }} />
      </div>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            <Badge>{current.type}</Badge>
            <Badge className="bg-amber-50 text-amber-800 ring-amber-100">{current.difficulty}</Badge>
          </div>
          <CardTitle className="text-xl leading-8">Flashcard review</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div style={{ perspective: "1200px" }}>
            <button type="button" onClick={flipCard} className="group block w-full text-left outline-none" aria-label={revealed ? "Show question" : "Reveal answer"}>
              <div
                className="relative min-h-[340px] rounded-xl transition-transform duration-500 ease-out group-focus-visible:ring-2 group-focus-visible:ring-emerald-600"
                style={{
                  transformStyle: "preserve-3d",
                  transform: revealed ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                <div
                  className="absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                  style={{ backfaceVisibility: "hidden" }}
                >
                  <div className="flex flex-1 items-center justify-center">
                    <h2 className="max-w-2xl text-center text-xl font-semibold leading-8 text-slate-950 sm:text-2xl">{current.question}</h2>
                  </div>
                  {options.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {options.map((option, optionIndex) => (
                        <div key={option} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                          {String.fromCharCode(65 + optionIndex)}. {option}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="mt-5 text-center text-sm text-slate-500">Flip to reveal the answer.</p>
                </div>

                <div
                  className="absolute inset-0 flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                  style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                >
                  <div className="flex flex-1 flex-col justify-center gap-4">
                    <p className="text-sm font-semibold text-emerald-800">Answer</p>
                    <p className="text-lg font-semibold leading-8 text-slate-950">{current.answer}</p>
                    {current.explanation ? <p className="rounded-md bg-slate-50 p-3 text-sm leading-6 text-slate-700">{current.explanation}</p> : null}
                  </div>
                </div>
              </div>
            </button>
          </div>

          {!revealed ? (
            <Button variant="ink" onClick={flipCard} className="w-full">
              Reveal answer
            </Button>
          ) : null}
          {error ? <p className="mt-4 rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
          {revealed ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Button variant="secondary" onClick={() => rate("again")}>
                <RotateCcw className="h-4 w-4" />
                Again
              </Button>
              <Button variant="secondary" onClick={() => rate("hard")}>
                Hard
              </Button>
              <Button onClick={() => rate("good")}>Good</Button>
              <Button variant="ink" onClick={() => rate("easy")}>
                Easy
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
