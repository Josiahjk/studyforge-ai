"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, RotateCcw, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { checkTypedAnswer } from "@/lib/answer-check";
import { playAnswerSound } from "@/lib/answer-sounds";
import { estimateBatchedGeneration } from "@/lib/generation-estimates";
import { cn } from "@/lib/utils";

type DeckCard = {
  id: string;
  question: string;
  answer: string;
  optionsJson: string | null;
  explanation: string | null;
};

type QuizQuestion = {
  type: "mcq" | "truefalse" | "short";
  question: string;
  options?: string[];
  answer: string;
  explanation: string;
  hint?: string;
  acceptableAnswers?: string[];
  retry?: boolean;
};

const QUESTION_BATCH_SIZE = 10;
const OPTION_LABELS = ["A", "B", "C", "D"];

type DeckQuizDraft = {
  questions: QuizQuestion[];
  answers: Record<number, string>;
  checkedShortAnswers: Record<number, boolean>;
  shownHints: Record<number, boolean>;
  currentIndex: number;
  finished: boolean;
  savedAttempt: boolean;
  quizCount: number;
};

function deckQuizStorageKey(deckId: string) {
  return `studyforge-deck-quiz-progress:v3:${deckId}`;
}

function isQuizQuestion(value: unknown): value is QuizQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<QuizQuestion>;
  return (
    (question.type === "mcq" || question.type === "truefalse" || question.type === "short") &&
    typeof question.question === "string" &&
    typeof question.answer === "string" &&
    typeof question.explanation === "string" &&
    (!question.options || (Array.isArray(question.options) && question.options.every((option) => typeof option === "string")))
  );
}

function parseStringRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, string>>((record, [index, answer]) => {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && typeof answer === "string") {
      record[numericIndex] = answer;
    }
    return record;
  }, {});
}

function parseBooleanRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, boolean>>((record, [index, checked]) => {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && typeof checked === "boolean") {
      record[numericIndex] = checked;
    }
    return record;
  }, {});
}

function readDeckQuizDraft(deckId: string): DeckQuizDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(deckQuizStorageKey(deckId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeckQuizDraft>;
    const questions = Array.isArray(parsed.questions) ? parsed.questions.filter(isQuizQuestion) : [];
    if (questions.length === 0) return null;
    return {
      questions,
      answers: parseStringRecord(parsed.answers),
      checkedShortAnswers: parseBooleanRecord(parsed.checkedShortAnswers),
      shownHints: parseBooleanRecord(parsed.shownHints),
      currentIndex: Math.min(Math.max(0, Number(parsed.currentIndex) || 0), questions.length - 1),
      finished: parsed.finished === true,
      savedAttempt: parsed.savedAttempt === true,
      quizCount: Math.min(50, Math.max(1, Number(parsed.quizCount) || questions.length)),
    };
  } catch {
    return null;
  }
}

function writeDeckQuizDraft(deckId: string, draft: DeckQuizDraft) {
  if (typeof window === "undefined" || draft.questions.length === 0) return;
  window.localStorage.setItem(deckQuizStorageKey(deckId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
}

function appendUniqueQuestions(existing: QuizQuestion[], incoming: QuizQuestion[], limit: number) {
  const seen = new Set(existing.map((question) => question.question.trim().toLowerCase()));
  const output = [...existing];
  for (const question of incoming) {
    const key = question.question.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(question);
    if (output.length >= limit) break;
  }
  return output;
}

function buildLocalQuestions(cards: DeckCard[]): QuizQuestion[] {
  return cards.slice(0, 10).map((card) => {
    let options: string[] = [];
    if (card.optionsJson) {
      try {
        options = JSON.parse(card.optionsJson);
      } catch {
        options = [];
      }
    }
    return {
      type: options.length ? "mcq" : "short",
      question: card.question,
      options: options.length ? options : undefined,
      answer: card.answer,
      explanation: card.explanation || "Review the source card and compare your reasoning to the answer.",
      hint: "Recall the answer from the original card before checking.",
      acceptableAnswers: [card.answer],
    };
  });
}

export function QuizClient({ deckId, deckTitle, cards }: { deckId: string; deckTitle: string; cards: DeckCard[] }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => buildLocalQuestions(cards));
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [checkedShortAnswers, setCheckedShortAnswers] = useState<Record<number, boolean>>({});
  const [shownHints, setShownHints] = useState<Record<number, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [savedAttempt, setSavedAttempt] = useState(false);
  const [quizCount, setQuizCount] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressState | null>(null);
  const [readyToPersist, setReadyToPersist] = useState(false);

  const score = useMemo(() => {
    return questions.reduce((total, question, index) => {
      const answer = (answers[index] || "").trim().toLowerCase();
      const expected = question.answer.trim().toLowerCase();
      return total + (checkTypedAnswer(answer, expected, question.acceptableAnswers || []).correct ? 1 : 0);
    }, 0);
  }, [answers, questions]);
  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex] || "";
  const currentAnswered = currentQuestion?.options?.length ? Boolean(currentAnswer) : Boolean(checkedShortAnswers[currentIndex]);

  function clampCount(value: number) {
    if (!Number.isFinite(value)) return 1;
    return Math.min(50, Math.max(1, Math.round(value)));
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = readDeckQuizDraft(deckId);
      if (draft) {
        setQuestions(draft.questions);
        setAnswers(draft.answers);
        setCheckedShortAnswers(draft.checkedShortAnswers);
        setShownHints(draft.shownHints);
        setCurrentIndex(draft.currentIndex);
        setFinished(draft.finished);
        setSavedAttempt(draft.savedAttempt);
        setQuizCount(draft.quizCount);
        if (!draft.finished) setNotice("Restored your saved quiz progress.");
      }
      setReadyToPersist(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [deckId]);

  useEffect(() => {
    if (!readyToPersist) return;
    writeDeckQuizDraft(deckId, { questions, answers, checkedShortAnswers, shownHints, currentIndex, finished, savedAttempt, quizCount });
  }, [answers, checkedShortAnswers, currentIndex, deckId, finished, questions, quizCount, readyToPersist, savedAttempt, shownHints]);

  async function generateWithAi() {
    setLoading(true);
    setError("");
    setNotice("");
    const batchTotal = Math.max(1, Math.ceil(quizCount / QUESTION_BATCH_SIZE));
    let nextQuestions: QuizQuestion[] = [];
    const warnings: string[] = [];
    setGenerationProgress({
      label: "Generating multiple-choice questions",
      detail: `Starting batch 1 of ${batchTotal}.`,
      estimate: estimateBatchedGeneration(quizCount, QUESTION_BATCH_SIZE),
      startedAt: Date.now(),
    });

    for (let batchIndex = 0; batchIndex < batchTotal && nextQuestions.length < quizCount; batchIndex += 1) {
      const requestedCount = Math.min(QUESTION_BATCH_SIZE, quizCount - nextQuestions.length);
      setGenerationProgress((current) =>
        current
          ? {
              ...current,
              detail: `Batch ${batchIndex + 1} of ${batchTotal}: requesting up to ${requestedCount} questions from the AI model.`,
            }
          : current,
      );
      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckId, count: requestedCount }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoading(false);
        setGenerationProgress(null);
        setError(data.error?.message || `Could not generate batch ${batchIndex + 1}.`);
        return;
      }
      if (data.warning) warnings.push(data.warning);
      nextQuestions = appendUniqueQuestions(nextQuestions, data.questions || [], quizCount);
      setGenerationProgress((current) =>
        current
          ? {
              ...current,
              detail: `Batch ${batchIndex + 1} finished. ${nextQuestions.length} of ${quizCount} unique questions ready.`,
            }
          : current,
      );
    }

    if (nextQuestions.length === 0) {
      setLoading(false);
      setGenerationProgress(null);
      setError("The deck did not produce usable multiple-choice questions.");
      return;
    }

    setGenerationProgress((current) =>
      current ? { ...current, detail: "All batches finished. Saving quiz progress in this browser." } : current,
    );
    setQuestions(nextQuestions);
    setNotice(
      warnings[0] || `Created ${nextQuestions.length} multiple-choice questions${nextQuestions.length < quizCount ? ` out of ${quizCount} requested` : ""}.`,
    );
    setAnswers({});
    setCheckedShortAnswers({});
    setShownHints({});
    setCurrentIndex(0);
    setFinished(false);
    setSavedAttempt(false);
    setGenerationProgress((current) =>
      current ? { ...current, detail: "Questions are ready and progress will resume here next time.", complete: true } : current,
    );
    setLoading(false);
    window.setTimeout(() => setGenerationProgress(null), 1400);
  }

  function useLocalQuiz() {
    setQuestions(buildLocalQuestions(cards));
    setAnswers({});
    setCheckedShortAnswers({});
    setShownHints({});
    setCurrentIndex(0);
    setFinished(false);
    setSavedAttempt(false);
    setNotice("");
  }

  function chooseOption(option: string) {
    if (currentAnswered) return;
    const correct = currentQuestion ? scoreQuestion(currentQuestion, option) : false;
    if (currentQuestion) playAnswerSound(correct);
    setAnswers((state) => ({ ...state, [currentIndex]: option }));
    if (currentQuestion && !correct) setQuestions((state) => [...state, { ...currentQuestion, retry: true }]);
  }

  function checkShortAnswer() {
    if (currentQuestion && !scoreQuestion(currentQuestion, currentAnswer)) {
      setQuestions((state) => [...state, { ...currentQuestion, retry: true }]);
    }
    if (currentQuestion) playAnswerSound(scoreQuestion(currentQuestion, currentAnswer));
    setCheckedShortAnswers((state) => ({ ...state, [currentIndex]: true }));
  }

  function resetQuiz() {
    setAnswers({});
    setCheckedShortAnswers({});
    setShownHints({});
    setCurrentIndex(0);
    setFinished(false);
    setSavedAttempt(false);
  }

  async function finishQuiz() {
    setFinished(true);
    if (savedAttempt) return;
    setSavedAttempt(true);
    await fetch(`/api/quiz/${deckId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score, total: questions.length, questions, answers: Object.entries(answers) }),
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-col justify-between gap-4 pt-5 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-slate-500">{deckTitle}</p>
            <h2 className="text-xl font-bold">Practice quiz</h2>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-32 space-y-2">
              <Label>Questions</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={quizCount}
                onChange={(event) => setQuizCount(clampCount(Number(event.target.value)))}
              />
            </div>
            <Button variant="secondary" onClick={useLocalQuiz}>
              Local Quiz
            </Button>
            <Button onClick={generateWithAi} disabled={loading}>
              <WandSparkles className="h-4 w-4" />
              {loading ? "Generating..." : "Generate multiple-choice"}
            </Button>
          </div>
        </CardContent>
      </Card>
      {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {notice ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{notice}</p> : null}
      {generationProgress ? <GenerationProgress progress={generationProgress} /> : null}
      {currentQuestion && !finished ? (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Question {currentIndex + 1} of {questions.length}
                </p>
                <CardTitle className="mt-2 text-lg">{currentQuestion.question}</CardTitle>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {currentQuestion.retry ? <Badge>Retry</Badge> : null}
                <Badge>{currentQuestion.options?.length ? "Multiple choice" : currentQuestion.type}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.round(((currentIndex + Number(currentAnswered)) / Math.max(1, questions.length)) * 100)}%`,
                  background: "var(--accent-bg)",
                }}
              />
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setShownHints((state) => ({ ...state, [currentIndex]: !state[currentIndex] }))}
            >
              <Lightbulb className="h-4 w-4" />
              {shownHints[currentIndex] ? "Hide hint" : "Hint"}
            </Button>
            {shownHints[currentIndex] ? (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-950">
                {currentQuestion.hint || "Recall the matching source card before answering."}
              </p>
            ) : null}

            {currentQuestion.options?.length ? (
              <div className="grid gap-2">
                {currentQuestion.options.map((option, optionIndex) => {
                  const selected = currentAnswer === option;
                  const correct = option.trim().toLowerCase() === currentQuestion.answer.trim().toLowerCase();
                  const wrongSelected = currentAnswered && selected && !correct;
                  return (
                    <button
                      key={`${option}-${optionIndex}`}
                      type="button"
                      onClick={() => chooseOption(option)}
                      disabled={currentAnswered}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-left text-sm transition hover:bg-slate-50 disabled:cursor-default",
                        currentAnswered && correct && "border-emerald-300 bg-emerald-50 text-emerald-950",
                        wrongSelected && "border-rose-300 bg-rose-50 text-rose-950",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50",
                          currentAnswered && correct && "border-emerald-700 bg-emerald-700 text-white",
                          wrongSelected && "border-rose-600 bg-rose-600 text-white",
                        )}
                      >
                        {currentAnswered && correct ? <CheckCircle2 className="h-4 w-4" /> : OPTION_LABELS[optionIndex]}
                      </span>
                      <span>{option}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  value={currentAnswer}
                  onChange={(event) => setAnswers((state) => ({ ...state, [currentIndex]: event.target.value }))}
                  placeholder="Your answer"
                  disabled={currentAnswered}
                />
                {!currentAnswered ? (
                  <Button onClick={checkShortAnswer} disabled={!currentAnswer.trim()}>
                    Check answer
                  </Button>
                ) : null}
                {currentAnswered ? (
                  <div className="grid gap-2 text-sm">
                    <p
                      className={cn(
                        "rounded-md p-2",
                        scoreQuestion(currentQuestion, currentAnswer)
                          ? "bg-emerald-50 text-emerald-900"
                          : "bg-rose-50 text-rose-900",
                      )}
                    >
                      Your answer: {currentAnswer || "No answer"}
                    </p>
                    <p className="rounded-md bg-emerald-50 p-2 text-emerald-900">Correct answer: {currentQuestion.answer}</p>
                  </div>
                ) : null}
              </div>
            )}

            {currentAnswered ? (
              <div
                className={cn(
                  "rounded-md p-3 text-sm leading-6",
                  scoreQuestion(currentQuestion, currentAnswer) ? "bg-emerald-50 text-emerald-950" : "bg-rose-50 text-rose-950",
                )}
              >
                <p className="font-semibold">{scoreQuestion(currentQuestion, currentAnswer) ? "Correct" : "Not quite"}</p>
                <p className="mt-1 rounded-md bg-emerald-100/70 p-2 text-emerald-950">Answer: {currentQuestion.answer}</p>
                <p className="mt-2">{currentQuestion.explanation}</p>
                {!scoreQuestion(currentQuestion, currentAnswer) ? <p className="mt-2 font-medium">This question was added again at the end.</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {finished ? (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm text-slate-500">Quiz complete</p>
              <h3 className="text-2xl font-bold text-slate-950">
                Score: {score}/{questions.length}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setFinished(false); setCurrentIndex(0); }}>
                Review questions
              </Button>
              <Button variant="secondary" onClick={resetQuiz}>
                <RotateCcw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {questions.length === 0 ? (
        <Card>
          <CardContent className="pt-5 text-sm text-slate-600">Add cards before starting a quiz.</CardContent>
        </Card>
      ) : null}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
            disabled={questions.length === 0 || currentIndex === 0 || finished}
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
          {currentIndex < questions.length - 1 ? (
            <Button
              onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))}
              disabled={questions.length === 0 || !currentAnswered || finished}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finishQuiz} disabled={questions.length === 0 || !currentAnswered || finished}>
              <CheckCircle2 className="h-4 w-4" />
              Finish
            </Button>
          )}
          <Button variant="secondary" onClick={resetQuiz}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
        </div>
        <Button asChild variant="secondary">
          <Link href={`/decks/${deckId}`}>
            <Bot className="h-4 w-4" />
            Deck
          </Link>
        </Button>
      </div>
    </div>
  );
}

function scoreQuestion(question: QuizQuestion, answer: string) {
  return checkTypedAnswer(answer, question.answer, question.acceptableAnswers || []).correct;
}
