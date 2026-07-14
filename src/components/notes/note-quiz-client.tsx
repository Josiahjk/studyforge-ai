"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Eye, Keyboard, Lightbulb, MessageCircle, RotateCcw, WandSparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GenerationProgress, type GenerationProgressState } from "@/components/ui/generation-progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkTypedAnswer } from "@/lib/answer-check";
import { playAnswerSound } from "@/lib/answer-sounds";
import { estimateBatchedGeneration } from "@/lib/generation-estimates";
import { cn } from "@/lib/utils";

export type NoteQuizQuestion = {
  question: string;
  choices: string[];
  correctAnswerIndex: number;
  explanation: string;
  hint?: string;
  answer?: string;
  acceptableAnswers?: string[];
  retry?: boolean;
};

export type QuizSourceImage = {
  id: string;
  imageIndex: number;
  pageNumber?: number | null;
  label: string;
  dataUrl: string;
  altText?: string | null;
  searchText: string;
};

const MAX_QUIZ_QUESTIONS = 150;
const QUESTION_BATCH_SIZE = 20;
const FAST_FACT_THRESHOLD = 30;
const AUTO_ADVANCE_CORRECT_MS = 2500;
const AUTO_ADVANCE_REVIEW_MS = 4500;
const OPTION_LABELS = ["A", "B", "C", "D"];

type PracticeMode = "choice" | "typing";

type NoteQuizDraft = {
  questions: NoteQuizQuestion[];
  answers: Record<number, number>;
  typedAnswers: Record<number, string>;
  checkedTypedAnswers: Record<number, boolean>;
  shownHints: Record<number, boolean>;
  shownExplanations: Record<number, boolean>;
  revealedAnswers: Record<number, boolean>;
  currentIndex: number;
  finished: boolean;
  quizCount: number;
  autoCount: boolean;
  practiceMode: PracticeMode;
};

function noteQuizStorageKey(noteId: string) {
  return `studyforge-note-quiz-progress:v3:${noteId}`;
}

function isNoteQuizQuestion(value: unknown): value is NoteQuizQuestion {
  if (!value || typeof value !== "object") return false;
  const question = value as Partial<NoteQuizQuestion>;
  return (
    typeof question.question === "string" &&
    Array.isArray(question.choices) &&
    question.choices.length >= 2 &&
    question.choices.every((choice) => typeof choice === "string") &&
    typeof question.correctAnswerIndex === "number" &&
    typeof question.explanation === "string"
  );
}

function parseNumberRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, number>>((record, [index, answer]) => {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && typeof answer === "number") record[numericIndex] = answer;
    return record;
  }, {});
}

function parseStringRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, string>>((record, [index, answer]) => {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && typeof answer === "string") record[numericIndex] = answer;
    return record;
  }, {});
}

function parseBooleanRecord(value: unknown) {
  if (!value || typeof value !== "object") return {};
  return Object.entries(value as Record<string, unknown>).reduce<Record<number, boolean>>((record, [index, value]) => {
    const numericIndex = Number(index);
    if (Number.isInteger(numericIndex) && numericIndex >= 0 && typeof value === "boolean") record[numericIndex] = value;
    return record;
  }, {});
}

function readNoteQuizDraft(noteId: string): NoteQuizDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(noteQuizStorageKey(noteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<NoteQuizDraft>;
    const rawQuestions = Array.isArray(parsed.questions) ? parsed.questions.filter(isNoteQuizQuestion).slice(0, MAX_QUIZ_QUESTIONS) : [];
    const questions = sanitizeQuestions(rawQuestions);
    if (questions.length === 0) return null;
    const removedStaleQuestions = questions.length !== rawQuestions.length;
    return {
      questions,
      answers: removedStaleQuestions ? {} : parseNumberRecord(parsed.answers),
      typedAnswers: removedStaleQuestions ? {} : parseStringRecord(parsed.typedAnswers),
      checkedTypedAnswers: removedStaleQuestions ? {} : parseBooleanRecord(parsed.checkedTypedAnswers),
      shownHints: removedStaleQuestions ? {} : parseBooleanRecord(parsed.shownHints),
      shownExplanations: removedStaleQuestions ? {} : parseBooleanRecord(parsed.shownExplanations),
      revealedAnswers: removedStaleQuestions ? {} : parseBooleanRecord(parsed.revealedAnswers),
      currentIndex: removedStaleQuestions ? 0 : Math.min(Math.max(0, Number(parsed.currentIndex) || 0), questions.length - 1),
      finished: removedStaleQuestions ? false : parsed.finished === true,
      quizCount: clampCount(Number(parsed.quizCount) || questions.length),
      autoCount: parsed.autoCount !== false,
      practiceMode: parsed.practiceMode === "typing" ? "typing" : "choice",
    };
  } catch {
    return null;
  }
}

function writeNoteQuizDraft(noteId: string, draft: NoteQuizDraft) {
  if (typeof window === "undefined" || draft.questions.length === 0) return;
  window.localStorage.setItem(noteQuizStorageKey(noteId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
}

function normalizeGeneratedQuestions(data: {
  questions?: Array<{
    question: string;
    options: string[];
    answer: string;
    explanation: string;
    hint?: string;
    acceptableAnswers?: string[];
  }>;
}) {
  return (data.questions || []).map((question) => {
    const correctAnswerIndex = Math.max(0, question.options.findIndex((option) => option.toLowerCase() === question.answer.toLowerCase()));
    return {
      question: question.question,
      choices: question.options,
      correctAnswerIndex,
      answer: question.answer || question.options[correctAnswerIndex] || question.options[0] || "",
      explanation: question.explanation,
      hint: question.hint || "",
      acceptableAnswers: question.acceptableAnswers || [],
    };
  }).filter(isUsableQuizQuestion);
}

function appendUniqueQuestions(existing: NoteQuizQuestion[], incoming: NoteQuizQuestion[], limit: number) {
  const seen = new Set(existing.flatMap((question) => questionFingerprints(question)));
  const output = [...existing];
  for (const question of sanitizeQuestions(incoming)) {
    const fingerprints = questionFingerprints(question);
    if (fingerprints.length === 0 || fingerprints.some((fingerprint) => seen.has(fingerprint))) continue;
    fingerprints.forEach((fingerprint) => seen.add(fingerprint));
    output.push(question);
    if (output.length >= limit) break;
  }
  return output;
}

function clampCount(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_QUIZ_QUESTIONS, Math.max(1, Math.round(value)));
}

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length || 0;
}

function estimateAutoCount(sourceNotes: string, initialCount: number) {
  const plain = sourceNotes
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = plain.split(/\s+/).filter(Boolean).length;
  const sectionCount = Math.max(1, sourceNotes.split(/\n{2,}/).filter((part) => part.trim().length > 80).length);
  const bulletCount = countMatches(sourceNotes, /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+\S/g);
  const labelCount = countMatches(sourceNotes, /\b[A-Za-z][A-Za-z0-9 /()'-]{2,48}\s*:/g);
  const sentenceCount = countMatches(plain, /[.!?](?:\s|$)/g);
  const pageCount = new Set((sourceNotes.match(/\bPage\s+\d+/gi) || []).map((page) => page.toLowerCase())).size;
  const imageCount = countMatches(sourceNotes, /\b(?:Image|Source visual)\b/gi);
  const tableOrDiagramSignals = countMatches(sourceNotes, /\b(table|diagram|graph|chart|axis|label|function|formula|process|steps?|types?|examples?)\b/gi);
  const conceptEstimate = Math.max(
    initialCount || 0,
    Math.round(wordCount / 35),
    sectionCount * 6,
    bulletCount + Math.floor(labelCount * 0.75) + Math.floor(sentenceCount * 0.55),
    pageCount * 8,
    Math.floor(imageCount * 5),
    Math.floor(tableOrDiagramSignals / 2),
  );
  return clampCount(conceptEstimate);
}

function correctAnswerFor(question: NoteQuizQuestion) {
  return question.answer || question.choices[Math.min(question.correctAnswerIndex, Math.max(0, question.choices.length - 1))] || "";
}

function isWeakHint(value: string) {
  return /think about the note section|source term that starts|eliminate choices that do not match/i.test(value);
}

function answerFocus(answer: string, question = "") {
  const questionWords = new Set(
    question
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff-]/gi, ""))
      .filter(Boolean),
  );
  const stopWords = new Set([
    "about",
    "answer",
    "because",
    "concept",
    "correctly",
    "describes",
    "diagram",
    "different",
    "does",
    "from",
    "notes",
    "option",
    "question",
    "shows",
    "statement",
    "study",
    "that",
    "their",
    "these",
    "this",
    "what",
    "which",
    "with",
  ]);
  const words = answer
    .replace(/^diagram:\s*/i, "")
    .replace(/^([^:]{3,80}):\s*/, "")
    .replace(/["'()]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff-]/gi, ""))
    .filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()) && !questionWords.has(word.toLowerCase()));
  return words.slice(0, 5).join(" ");
}

function normalizedFingerprint(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function questionFingerprints(question: NoteQuizQuestion) {
  return [
    normalizedFingerprint(question.question),
    normalizedFingerprint(correctAnswerFor(question)),
    normalizedFingerprint(question.explanation),
  ].filter((fingerprint) => fingerprint.length > 18);
}

const IMPORT_ARTIFACT_PATTERN =
  /\b(each section has a corresponding image|corresponding image|brief description|source visual|uploaded image|ai vision analysis|selected frame ai vision|fallback text extraction|user safety|no readable text)\b/i;

const GENERIC_QUESTION_PATTERN =
  /^(what detail is shown in|which source fact connects|what should you remember about this concept|which detail about this concept)\b/i;

function isImportArtifactText(value: string) {
  return IMPORT_ARTIFACT_PATTERN.test(value) || /^page\s+\d+\b/i.test(value.trim()) || /^image\s+\d+\b/i.test(value.trim());
}

function isUsableQuizQuestion(question: NoteQuizQuestion) {
  const answer = correctAnswerFor(question);
  const combined = `${question.question}\n${answer}\n${question.explanation}\n${question.choices.join("\n")}`;
  if (GENERIC_QUESTION_PATTERN.test(question.question.trim())) return false;
  if (isImportArtifactText(answer) || isImportArtifactText(question.explanation)) return false;
  if (question.choices.some(isImportArtifactText)) return false;
  if (/\b(this option does not match|different idea from the source material)\b/i.test(answer)) return false;
  if (question.choices.length < 2 || !answer.trim()) return false;
  const uniqueChoices = new Set(question.choices.map((choice) => normalizedFingerprint(choice)).filter(Boolean));
  if (uniqueChoices.size < Math.min(2, question.choices.length)) return false;
  return !/\bwhat detail is shown in\s+(economics|this concept|this visual)\?/i.test(combined);
}

function sanitizeQuestions(questions: NoteQuizQuestion[]) {
  return questions.filter(isUsableQuizQuestion).slice(0, MAX_QUIZ_QUESTIONS);
}

function fallbackHint(question: NoteQuizQuestion) {
  const existingHint = question.hint?.trim() || "";
  if (existingHint && !isWeakHint(existingHint)) return existingHint;
  const answer = correctAnswerFor(question);
  const focus = answerFocus(answer, question.question);
  if (/\b(graph|chart|curve|axis)\b/i.test(answer)) {
    return "Use the visual clue: compare the axes, curve direction, and what changes over time.";
  }
  if (/\b(diagram|visual|flowchart|table)\b/i.test(answer)) {
    return focus ? `Use the labels and arrows in the visual; the key clue is about "${focus}".` : "Use the labels and arrows in the visual.";
  }
  if (/\b(price|quantity demanded|quantity supplied|demand|supply)\b/i.test(answer)) {
    return "Watch how price and quantity move; demand and supply do not move the same way.";
  }
  if (/\b(limited resources|unlimited wants|scarcity)\b/i.test(answer)) {
    return "Look for the idea of limited resources being used to satisfy unlimited wants.";
  }
  if (/\b(opportunity cost|next best alternative)\b/i.test(answer)) {
    return "The clue is what you give up when choosing one option over another.";
  }
  if (/\b(cause|causes|because|therefore|effect|results?|leads to)\b/i.test(answer)) {
    return "Find the option that keeps the cause and the result in the right order.";
  }
  if (/\b(difference|compare|whereas|while|however|but)\b/i.test(answer)) {
    return "Compare the two sides carefully; one option should keep both parts correct.";
  }
  return focus ? `Focus on the clue words "${focus}" and choose the option about that idea.` : "Look for the option that matches the exact study fact.";
}

function completeTrailingQuestionWord(question: NoteQuizQuestion) {
  const text = question.question
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\babout Study the concept of\s+/i, "about ")
    .replace(/\babout Study\s+/i, "about ")
    .replace(/\s*,?\s+\b(?:as|because|that|when|where|which)\?$/i, "?");
  const match = /^(.*\b)([A-Za-z]{3,6})(\?)$/.exec(text);
  if (!match) return text;

  const partial = match[2].toLowerCase();
  const commonCompleteWords = new Set(["about", "after", "answer", "before", "cause", "chart", "graph", "which", "what", "where"]);
  if (commonCompleteWords.has(partial)) return text;

  const context = `${correctAnswerFor(question)} ${question.explanation} ${question.choices.join(" ")}`;
  const contextWords = (context.match(/[A-Za-z][A-Za-z-]{3,}/g) || []).map((word) => word.replace(/-+$/g, ""));
  if (contextWords.some((word) => word.toLowerCase() === partial)) return text;

  const completion = contextWords.find((word) => {
    const lowered = word.toLowerCase();
    return lowered.startsWith(partial) && lowered.length > partial.length && lowered.length <= 24;
  });
  return completion ? `${match[1]}${completion}${match[3]}` : text;
}

function displayQuestionText(question: NoteQuizQuestion) {
  const text = completeTrailingQuestionWord(question);
  if (/^what does the visual information show about\s+(economics|this concept|this visual)\?$/i.test(text)) {
    const answer = correctAnswerFor(question);
    if (/\bflowchart\b/i.test(answer)) return "Which visual detail is shown in the flowchart?";
    if (/\b(graph|curve|axis)\b/i.test(answer)) return "Which visual detail is shown in the graph?";
    if (/\b(table|row|column)\b/i.test(answer)) return "Which visual detail is shown in the table?";
    if (/\bdiagram\b/i.test(answer)) return "Which visual detail is shown in the diagram?";
    const focus = answerFocus(answer, text);
    return focus ? `Which visual detail shows "${focus}"?` : "Which visual detail is shown in the source image?";
  }
  return text;
}

const VISUAL_QUESTION_PATTERN =
  /\b(graph|diagram|chart|table|visual|image|picture|figure|flowchart|axis|curve|slope|label|labels|arrow|arrows|illustration|screenshot|formula|map)\b/i;

const VISUAL_STOP_WORDS = new Set([
  "about",
  "answer",
  "based",
  "because",
  "choice",
  "choices",
  "correct",
  "describe",
  "describes",
  "detail",
  "different",
  "does",
  "from",
  "image",
  "into",
  "notes",
  "option",
  "question",
  "shown",
  "shows",
  "source",
  "statement",
  "study",
  "that",
  "these",
  "this",
  "visual",
  "what",
  "when",
  "where",
  "which",
  "with",
]);

function keywordTokens(value: string) {
  const seen = new Set<string>();
  return (value.match(/[a-z0-9][a-z0-9-]{3,}/gi) || [])
    .map((token) => token.toLowerCase().replace(/^-+|-+$/g, ""))
    .filter((token) => token.length >= 4 && !VISUAL_STOP_WORDS.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    })
    .slice(0, 48);
}

function questionNeedsSourceVisual(question: NoteQuizQuestion) {
  if (!isUsableQuizQuestion(question)) return false;
  return VISUAL_QUESTION_PATTERN.test(`${displayQuestionText(question)} ${correctAnswerFor(question)} ${question.explanation}`);
}

function scoreSourceVisual(question: NoteQuizQuestion, image: QuizSourceImage) {
  const query = `${displayQuestionText(question)} ${correctAnswerFor(question)} ${question.explanation}`;
  const search = `${image.label} ${image.altText || ""} ${image.searchText}`.toLowerCase();
  if (!search.trim()) return 0;

  let score = 0;
  for (const pageMatch of query.matchAll(/\bpage\s*(\d+)\b/gi)) {
    if (image.pageNumber === Number(pageMatch[1])) score += 6;
  }

  for (const token of keywordTokens(query)) {
    if (search.includes(token)) score += VISUAL_QUESTION_PATTERN.test(token) ? 2 : 1;
  }

  if (/\b(graph|chart|curve|axis|slope)\b/i.test(query) && /\b(graph|chart|curve|axis|slope|demand|supply|price|quantity|product)\b/i.test(search)) {
    score += 2;
  }
  if (/\b(diagram|flowchart|label|arrow|illustration)\b/i.test(query) && /\b(diagram|flowchart|label|arrow|function|structure|process)\b/i.test(search)) {
    score += 2;
  }
  return score;
}

function sourceVisualForQuestion(question: NoteQuizQuestion, images: QuizSourceImage[]) {
  if (!questionNeedsSourceVisual(question) || images.length === 0) return null;
  const best = images
    .map((image) => ({ image, score: scoreSourceVisual(question, image) }))
    .sort((left, right) => right.score - left.score)[0];
  return best && best.score >= 3 ? best.image : null;
}

export function NoteQuizClient({
  noteId,
  title,
  sourceNotes,
  initialQuestions,
  sourceImages = [],
  mode = "practice",
}: {
  noteId: string;
  title: string;
  sourceNotes: string;
  initialQuestions: NoteQuizQuestion[];
  sourceImages?: QuizSourceImage[];
  mode?: "practice" | "create";
}) {
  const sanitizedInitialQuestions = useMemo(() => sanitizeQuestions(initialQuestions), [initialQuestions]);
  const autoTarget = useMemo(() => estimateAutoCount(sourceNotes, sanitizedInitialQuestions.length || 10), [sanitizedInitialQuestions.length, sourceNotes]);
  const [questions, setQuestions] = useState(sanitizedInitialQuestions);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [typedAnswers, setTypedAnswers] = useState<Record<number, string>>({});
  const [checkedTypedAnswers, setCheckedTypedAnswers] = useState<Record<number, boolean>>({});
  const [shownHints, setShownHints] = useState<Record<number, boolean>>({});
  const [shownExplanations, setShownExplanations] = useState<Record<number, boolean>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [quizCount, setQuizCount] = useState(autoTarget);
  const [autoCount, setAutoCount] = useState(true);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("choice");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressState | null>(null);
  const [readyToPersist, setReadyToPersist] = useState(false);
  const [autoAdvanceIndex, setAutoAdvanceIndex] = useState<number | null>(null);

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers[currentIndex];
  const typedAnswer = typedAnswers[currentIndex] || "";
  const typedChecked = checkedTypedAnswers[currentIndex] === true;
  const currentRevealed = revealedAnswers[currentIndex] === true;
  const currentAnswered = currentRevealed || typedChecked || currentAnswer !== undefined;
  const currentExplanationShown = shownExplanations[currentIndex] === true;
  const currentVisual = useMemo(
    () => (currentQuestion ? sourceVisualForQuestion(currentQuestion, sourceImages) : null),
    [currentQuestion, sourceImages],
  );

  function questionCorrect(question: NoteQuizQuestion, index: number) {
    if (answers[index] !== undefined) return answers[index] === question.correctAnswerIndex;
    if (checkedTypedAnswers[index]) {
      return checkTypedAnswer(typedAnswers[index] || "", correctAnswerFor(question), question.acceptableAnswers || []).correct;
    }
    return false;
  }

  const currentCorrect = currentQuestion ? questionCorrect(currentQuestion, currentIndex) : false;

  const score = useMemo(
    () =>
      questions.reduce((sum, question, index) => {
        if (answers[index] !== undefined) return sum + (answers[index] === question.correctAnswerIndex ? 1 : 0);
        if (checkedTypedAnswers[index]) {
          return sum + (checkTypedAnswer(typedAnswers[index] || "", correctAnswerFor(question), question.acceptableAnswers || []).correct ? 1 : 0);
        }
        return sum;
      }, 0),
    [answers, checkedTypedAnswers, questions, typedAnswers],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const draft = mode === "practice" ? readNoteQuizDraft(noteId) : null;
      if (draft) {
        setQuestions(draft.questions);
        setAnswers(draft.answers);
        setTypedAnswers(draft.typedAnswers);
        setCheckedTypedAnswers(draft.checkedTypedAnswers);
        setShownHints(draft.shownHints);
        setShownExplanations(draft.shownExplanations);
        setRevealedAnswers(draft.revealedAnswers);
        setCurrentIndex(draft.currentIndex);
        setFinished(draft.finished);
        setQuizCount(draft.quizCount);
        setAutoCount(draft.autoCount);
        setPracticeMode(draft.practiceMode);
        if (!draft.finished && mode === "practice") setNotice("Restored your saved quiz progress.");
      }
      setReadyToPersist(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [mode, noteId]);

  useEffect(() => {
    if (!readyToPersist) return;
    writeNoteQuizDraft(noteId, {
      questions,
      answers,
      typedAnswers,
      checkedTypedAnswers,
      shownHints,
      shownExplanations,
      revealedAnswers,
      currentIndex,
      finished,
      quizCount,
      autoCount,
      practiceMode,
    });
  }, [
    answers,
    autoCount,
    checkedTypedAnswers,
    currentIndex,
    finished,
    noteId,
    practiceMode,
    questions,
    quizCount,
    readyToPersist,
    revealedAnswers,
    shownExplanations,
    shownHints,
    typedAnswers,
  ]);

  useEffect(() => {
    if (!currentQuestion || finished || autoAdvanceIndex !== currentIndex || !currentAnswered || currentExplanationShown) return;
    const timeout = window.setTimeout(
      () => {
        setAutoAdvanceIndex(null);
        if (currentIndex < questions.length - 1) {
          setCurrentIndex((index) => (index === currentIndex ? index + 1 : index));
        } else {
          setFinished(true);
        }
      },
      currentCorrect && !currentRevealed ? AUTO_ADVANCE_CORRECT_MS : AUTO_ADVANCE_REVIEW_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [
    autoAdvanceIndex,
    currentAnswered,
    currentCorrect,
    currentExplanationShown,
    currentIndex,
    currentQuestion,
    currentRevealed,
    finished,
    questions.length,
  ]);

  async function saveGeneratedQuestions(nextQuestions: NoteQuizQuestion[]) {
    const cleanedQuestions = sanitizeQuestions(nextQuestions);
    const response = await fetch(`/api/notes/${noteId}/quiz`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questions: cleanedQuestions }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || "Generated questions were saved locally, but not to the note.");
    }
  }

  async function regenerate() {
    const targetCount = autoCount ? autoTarget : quizCount;
    setLoading(true);
    setError("");
    setNotice("");
    const useFastFacts = targetCount > FAST_FACT_THRESHOLD;
    const batchTotal = useFastFacts ? 1 : Math.max(1, Math.ceil(targetCount / QUESTION_BATCH_SIZE));
    let nextQuestions: NoteQuizQuestion[] = [];
    const warnings: string[] = [];
    setGenerationProgress({
      label: "Generating multiple-choice questions",
      detail: useFastFacts
        ? `Breaking the notes into atomic facts for up to ${targetCount} questions.`
        : `Starting batch 1 of ${batchTotal}.`,
      estimate: useFastFacts ? "Est. 5s-20s" : estimateBatchedGeneration(targetCount, QUESTION_BATCH_SIZE),
      startedAt: Date.now(),
    });

    if (useFastFacts) {
      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: sourceNotes, count: targetCount, fastFacts: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoading(false);
        setGenerationProgress(null);
        setError(data.error?.message || "Could not create atomic fact questions from these notes.");
        return;
      }
      if (data.warning) warnings.push(data.warning);
      nextQuestions = appendUniqueQuestions([], normalizeGeneratedQuestions(data), targetCount);
      setGenerationProgress((current) =>
        current ? { ...current, detail: `${nextQuestions.length} atomic fact question(s) ready.` } : current,
      );
    }

    for (let batchIndex = 0; !useFastFacts && batchIndex < batchTotal && nextQuestions.length < targetCount; batchIndex += 1) {
      const requestedCount = Math.min(QUESTION_BATCH_SIZE, targetCount - nextQuestions.length);
      setGenerationProgress((current) =>
        current
          ? {
              ...current,
              detail: `Batch ${batchIndex + 1} of ${batchTotal}: finding ${requestedCount} new atomic fact question(s).`,
            }
          : current,
      );
      const response = await fetch("/api/ai/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: sourceNotes,
          count: requestedCount,
          avoidQuestions: nextQuestions.map((question) => question.question).slice(-120),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (nextQuestions.length > 0 && ["INSUFFICIENT_SOURCE", "MALFORMED_JSON"].includes(data.error?.code)) {
          warnings.push(data.error?.message || "No more unique questions were available.");
          break;
        }
        if (["AI_TIMEOUT", "INSUFFICIENT_SOURCE", "MALFORMED_JSON"].includes(data.error?.code)) {
          setGenerationProgress((current) =>
            current ? { ...current, detail: "AI batch was not usable. Switching to fast atomic fact questions." } : current,
          );
          const fallbackResponse = await fetch("/api/ai/quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notes: sourceNotes,
              count: targetCount,
              avoidQuestions: nextQuestions.map((question) => question.question).slice(-120),
              fastFacts: true,
            }),
          });
          const fallbackData = await fallbackResponse.json().catch(() => ({}));
          if (fallbackResponse.ok) {
            if (fallbackData.warning) warnings.push(fallbackData.warning);
            nextQuestions = appendUniqueQuestions(nextQuestions, normalizeGeneratedQuestions(fallbackData), targetCount);
            break;
          }
        }
        setLoading(false);
        setGenerationProgress(null);
        setError(data.error?.message || `Could not generate batch ${batchIndex + 1}.`);
        return;
      }
      if (data.warning) warnings.push(data.warning);
      const before = nextQuestions.length;
      nextQuestions = appendUniqueQuestions(nextQuestions, normalizeGeneratedQuestions(data), targetCount);
      setGenerationProgress((current) =>
        current ? { ...current, detail: `Batch ${batchIndex + 1} finished. ${nextQuestions.length} question(s) ready.` } : current,
      );
      if (nextQuestions.length === before) {
        warnings.push("The generator stopped because no additional unique facts were found.");
        break;
      }
    }

    if (nextQuestions.length === 0) {
      setLoading(false);
      setGenerationProgress(null);
      setError("The source material did not produce usable multiple-choice questions.");
      return;
    }

    nextQuestions = sanitizeQuestions(nextQuestions);
    if (nextQuestions.length === 0) {
      setLoading(false);
      setGenerationProgress(null);
      setError("The generator only produced weak or unrelated quiz items, so I blocked them. Try regenerating notes with more source detail.");
      return;
    }
    setQuestions(nextQuestions);
    setQuizCount(nextQuestions.length);
    try {
      setGenerationProgress((current) => (current ? { ...current, detail: "Saving generated questions to these notes." } : current));
      await saveGeneratedQuestions(nextQuestions);
      setNotice(
        `Created ${nextQuestions.length} question(s)${
          autoCount ? " from the available source material" : nextQuestions.length < targetCount ? ` out of ${targetCount} requested` : ""
        }.${warnings.length ? ` ${warnings[0]}` : ""} Saved to these notes.`,
      );
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Generated questions are ready.");
    }
    setAnswers({});
    setTypedAnswers({});
    setCheckedTypedAnswers({});
    setShownHints({});
    setShownExplanations({});
    setRevealedAnswers({});
    setAutoAdvanceIndex(null);
    setCurrentIndex(0);
    setFinished(false);
    setGenerationProgress((current) => (current ? { ...current, detail: "Questions are ready.", complete: true } : current));
    setLoading(false);
    window.setTimeout(() => setGenerationProgress(null), 1400);
  }

  function appendRetry(question: NoteQuizQuestion) {
    setQuestions((state) => [...state, { ...question, retry: true }]);
  }

  function continueQuiz() {
    setAutoAdvanceIndex(null);
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((index) => Math.min(questions.length - 1, index + 1));
    } else {
      setFinished(true);
    }
  }

  function chooseAnswer(choiceIndex: number) {
    if (!currentQuestion || currentAnswered) return;
    const correct = choiceIndex === currentQuestion.correctAnswerIndex;
    playAnswerSound(correct);
    setAnswers((state) => ({ ...state, [currentIndex]: choiceIndex }));
    if (!correct) appendRetry(currentQuestion);
    setAutoAdvanceIndex(currentIndex);
  }

  function checkTypingAnswer() {
    if (!currentQuestion || currentAnswered) return;
    const result = checkTypedAnswer(typedAnswer, correctAnswerFor(currentQuestion), currentQuestion.acceptableAnswers || []);
    playAnswerSound(result.correct);
    setCheckedTypedAnswers((state) => ({ ...state, [currentIndex]: true }));
    if (!result.correct) appendRetry(currentQuestion);
    setAutoAdvanceIndex(currentIndex);
  }

  function revealAnswer() {
    if (!currentQuestion || currentAnswered) return;
    setRevealedAnswers((state) => ({ ...state, [currentIndex]: true }));
    setAutoAdvanceIndex(currentIndex);
  }

  function resetQuiz() {
    setAnswers({});
    setTypedAnswers({});
    setCheckedTypedAnswers({});
    setShownHints({});
    setShownExplanations({});
    setRevealedAnswers({});
    setAutoAdvanceIndex(null);
    setCurrentIndex(0);
    setFinished(false);
  }

  const typedResult =
    currentQuestion && typedChecked
      ? checkTypedAnswer(typedAnswer, correctAnswerFor(currentQuestion), currentQuestion.acceptableAnswers || [])
      : null;

  return (
    <div className="space-y-6">
      {mode === "create" ? (
        <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm text-slate-500">{title}</p>
              <CardTitle>Create quiz</CardTitle>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/notes/${noteId}/quiz`}>
                  <CheckCircle2 className="h-4 w-4" />
                  Play quiz
                </Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/notes/${noteId}`}>
                  <ArrowLeft className="h-4 w-4" />
                  Notes
                </Link>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 lg:grid-cols-[minmax(180px,220px)_1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label>Questions</Label>
            <Input
              type="number"
              min={1}
              max={MAX_QUIZ_QUESTIONS}
              value={autoCount ? autoTarget : quizCount}
              onChange={(event) => {
                setAutoCount(false);
                setQuizCount(clampCount(Number(event.target.value)));
              }}
              disabled={autoCount}
            />
            <p className="text-xs text-slate-500">Max {MAX_QUIZ_QUESTIONS}. Auto estimates one question per small fact.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={autoCount ? "primary" : "secondary"} onClick={() => setAutoCount((value) => !value)}>
              {autoCount ? `Auto: ${autoTarget}` : "Auto off"}
            </Button>
            <Button type="button" variant={practiceMode === "choice" ? "primary" : "secondary"} onClick={() => setPracticeMode("choice")}>
              Multiple choice
            </Button>
            <Button type="button" variant={practiceMode === "typing" ? "primary" : "secondary"} onClick={() => setPracticeMode("typing")}>
              <Keyboard className="h-4 w-4" />
              Write answer
            </Button>
          </div>
          <Button onClick={regenerate} disabled={loading || sourceNotes.length < 80}>
            <WandSparkles className="h-4 w-4" />
            {loading ? "Generating..." : "Generate"}
          </Button>
        </CardContent>
        </Card>
      ) : null}

      {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : null}
      {generationProgress ? <GenerationProgress progress={generationProgress} /> : null}

      {mode === "practice" && currentQuestion && !finished ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Question {currentIndex + 1} of {questions.length}
                </p>
                <CardTitle className="mt-2 text-lg">Practice</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {currentQuestion.retry ? <Badge>Retry</Badge> : null}
                <Button type="button" variant={practiceMode === "choice" ? "primary" : "secondary"} size="sm" onClick={() => setPracticeMode("choice")}>
                  Multiple choice
                </Button>
                <Button type="button" variant={practiceMode === "typing" ? "primary" : "secondary"} size="sm" onClick={() => setPracticeMode("typing")}>
                  <Keyboard className="h-4 w-4" />
                  Write answer
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/notes/${noteId}/quiz/create`}>
                    <WandSparkles className="h-4 w-4" />
                    Create quiz
                  </Link>
                </Button>
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/notes/${noteId}`}>
                    <ArrowLeft className="h-4 w-4" />
                    Notes
                  </Link>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShownHints((state) => ({ ...state, [currentIndex]: !state[currentIndex] }))}
                >
                  <Lightbulb className="h-4 w-4" />
                  {shownHints[currentIndex] ? "Hide hint" : "Hint"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={revealAnswer} disabled={currentAnswered}>
                  <Eye className="h-4 w-4" />
                  Reveal
                </Button>
                <Button
                  type="button"
                  variant={currentExplanationShown ? "primary" : "secondary"}
                  size="sm"
                  onClick={() => {
                    setAutoAdvanceIndex(null);
                    setShownExplanations((state) => ({ ...state, [currentIndex]: !state[currentIndex] }));
                  }}
                  disabled={!currentAnswered}
                >
                  <MessageCircle className="h-4 w-4" />
                  {currentExplanationShown ? "Hide explain" : "Explain"}
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={resetQuiz}>
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
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

            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Question</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-950">{displayQuestionText(currentQuestion)}</h3>
            </section>

            {currentVisual ? (
              <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Source visual</p>
                <figure className="mt-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                  <Image
                    src={currentVisual.dataUrl}
                    alt={currentVisual.altText || currentVisual.label}
                    width={1200}
                    height={800}
                    unoptimized
                    className="max-h-[420px] w-full object-contain"
                  />
                  <figcaption className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500">{currentVisual.label}</figcaption>
                </figure>
              </section>
            ) : null}

            {shownHints[currentIndex] ? (
              <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Hint</p>
                <p className="mt-2">{fallbackHint(currentQuestion)}</p>
              </section>
            ) : null}

            {practiceMode === "choice" ? (
              <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Answer choices</p>
                <div className="mt-3 grid gap-2">
                {currentQuestion.choices.slice(0, 4).map((choice, choiceIndex) => {
                  const selected = currentAnswer === choiceIndex;
                  const correct = choiceIndex === currentQuestion.correctAnswerIndex;
                  const wrongSelected = currentAnswered && selected && !correct;
                  return (
                    <button
                      key={`${choice}-${choiceIndex}`}
                      type="button"
                      onClick={() => chooseAnswer(choiceIndex)}
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
                        {currentAnswered && correct ? <CheckCircle2 className="h-4 w-4" /> : OPTION_LABELS[choiceIndex]}
                      </span>
                      <span>{choice}</span>
                    </button>
                  );
                })}
                </div>
              </section>
            ) : (
              <section className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Write answer</p>
                <div className="mt-3 space-y-3">
                <Input
                  value={typedAnswer}
                  onChange={(event) => setTypedAnswers((state) => ({ ...state, [currentIndex]: event.target.value }))}
                  placeholder="Write your answer"
                  disabled={currentAnswered}
                />
                {!typedChecked && !currentAnswered ? (
                  <Button onClick={checkTypingAnswer} disabled={!typedAnswer.trim()}>
                    <WandSparkles className="h-4 w-4" />
                    AI check
                  </Button>
                ) : null}
                </div>
              </section>
            )}

            {currentAnswered ? (
              <section
                className={cn(
                  "rounded-md border p-4 text-sm leading-6",
                  currentRevealed
                    ? "border-sky-200 bg-sky-50 text-sky-950"
                    : currentCorrect
                      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                      : "border-rose-200 bg-rose-50 text-rose-950",
                )}
              >
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {currentRevealed ? "Revealed answer" : currentCorrect ? "Correct" : "Not quite"}
                </p>
                <p className="mt-2 rounded-md bg-white/70 p-3 font-medium text-emerald-950">Answer: {correctAnswerFor(currentQuestion)}</p>
                {typedResult ? <p className="mt-1 text-xs opacity-80">AI check: {typedResult.reason}</p> : null}
                {!currentCorrect ? <p className="mt-2 font-medium">This question was added again at the end.</p> : null}
              </section>
            ) : null}

            {currentExplanationShown ? (
              <section className="rounded-md border border-slate-200 bg-white p-4 text-sm leading-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Explain</p>
                <p className="mt-2 text-slate-700">{currentQuestion.explanation}</p>
                <Button type="button" className="mt-4" onClick={continueQuiz}>
                  Continue
                </Button>
              </section>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {mode === "practice" && finished ? (
        <Card>
          <CardContent className="space-y-4 pt-5">
            <div>
              <p className="text-sm text-slate-500">Quiz complete</p>
              <h3 className="text-2xl font-bold text-slate-950">
                Score: {score}/{questions.length}
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => { setFinished(false); setCurrentIndex(0); }}>Review questions</Button>
              <Button variant="secondary" onClick={resetQuiz}>
                <RotateCcw className="h-4 w-4" />
                Try again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {mode === "practice" && questions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>No quiz questions were saved for these notes yet.</span>
            <Button asChild size="sm">
              <Link href={`/notes/${noteId}/quiz/create`}>
                <WandSparkles className="h-4 w-4" />
                Create quiz
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {mode === "create" && questions.length > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
            <span>{questions.length} question(s) are saved for this quiz.</span>
            <Button asChild size="sm">
              <Link href={`/notes/${noteId}/quiz`}>
                <CheckCircle2 className="h-4 w-4" />
                Play quiz
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {notice ? (
        <div className="flex justify-end">
          <p className="w-fit max-w-full rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 shadow-sm ring-1 ring-amber-100">
            {notice}
          </p>
        </div>
      ) : null}
    </div>
  );
}
