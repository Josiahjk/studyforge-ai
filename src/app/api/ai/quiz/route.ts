import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { enforceAiCooldown, generateJson, type ModelMode, OpenRouterError } from "@/lib/openrouter";
import { studyLanguageInstruction } from "@/lib/study-language";
import { MAX_QUIZ_QUESTIONS, quizGenerateSchema } from "@/lib/validators";

const quizResponseSchema = z.object({
  questions: z.array(
    z.object({
      type: z.enum(["mcq"]).catch("mcq"),
      question: z.string().min(1),
      options: z.array(z.string()).min(4).max(4),
      answer: z.string().min(1),
      explanation: z.string().min(1),
      hint: z.string().optional().default(""),
      acceptableAnswers: z.array(z.string()).optional().default([]),
    }),
  ).min(1).max(MAX_QUIZ_QUESTIONS),
});

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function optionText(value: unknown) {
  if (typeof value === "string") return value.replace(/^[A-D][).:-]\s*/i, "").trim();
  const record = asRecord(value);
  return stringValue(record.text) || stringValue(record.label) || stringValue(record.value) || stringValue(record.option) || stringValue(record.answer);
}

function optionArray(value: unknown) {
  if (Array.isArray(value)) return value.map(optionText).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\r?\n|;|\|/)
      .map(optionText)
      .filter(Boolean);
  }
  return [];
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function indexFromLetter(value: unknown) {
  const text = stringValue(value).toUpperCase();
  if (/^[A-D]$/.test(text)) return text.charCodeAt(0) - 65;
  const match = text.match(/^([A-D])[).:-]/);
  return match ? match[1].charCodeAt(0) - 65 : -1;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledOptions(question: string, options: string[], answer: string) {
  const correctOption = options.find((option) => option.toLowerCase() === answer.toLowerCase()) || answer;
  const seed = hashString(`${question}\n${options.join("\n")}\n${correctOption}`);
  const random = seededRandom(seed);
  const shuffled = [...options];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const correctIndex = shuffled.findIndex((option) => option.toLowerCase() === correctOption.toLowerCase());
  if (correctIndex === 0 && shuffled.length > 1) {
    const targetIndex = (seed % (shuffled.length - 1)) + 1;
    [shuffled[0], shuffled[targetIndex]] = [shuffled[targetIndex], shuffled[0]];
  }

  return {
    options: shuffled,
    answer: correctOption,
  };
}

function truncateAtWord(value: string, maxLength: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  const shortened = clean.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
  return shortened || clean.slice(0, maxLength).trim();
}

function cleanQuestionFragment(value: string, maxLength = 90) {
  return truncateAtWord(value, maxLength)
    .replace(/^study the concept of\s+/i, "")
    .replace(/\s*,?\s*\b(?:and|as|at|because|for|from|in|into|of|on|or|that|the|to|when|where|which|with)$/i, "")
    .replace(/[,:;\-\s]+$/g, "")
    .trim();
}

function completeTrailingQuestionWord(question: string, context: string) {
  const trimmedQuestion = question.replace(/\s+/g, " ").trim();
  const match = /^(.*\b)([A-Za-z]{3,6})(\?)$/.exec(trimmedQuestion);
  if (!match) return trimmedQuestion;

  const partial = match[2].toLowerCase();
  const commonCompleteWords = new Set(["about", "after", "answer", "before", "cause", "chart", "graph", "which", "what", "where"]);
  if (commonCompleteWords.has(partial)) return trimmedQuestion;

  const contextWords = (context.match(/[A-Za-z][A-Za-z-]{3,}/g) || []).map((word) => word.replace(/-+$/g, ""));
  if (contextWords.some((word) => word.toLowerCase() === partial)) return trimmedQuestion;

  const completion = contextWords.find((word) => {
    const lowered = word.toLowerCase();
    return lowered.startsWith(partial) && lowered.length > partial.length && lowered.length <= 24;
  });
  return completion ? `${match[1]}${completion}${match[3]}` : trimmedQuestion;
}

const IMPORT_ARTIFACT_PATTERN =
  /\b(each section has a corresponding image|corresponding image|brief description|source visual|uploaded image|ai vision analysis|selected frame ai vision|fallback text extraction|user safety|no readable text)\b/i;

const GENERIC_QUESTION_PATTERN =
  /^(what detail is shown in|which source fact connects|what should you remember about this concept|which detail about this concept)\b/i;

function isImportArtifactText(value: string) {
  return IMPORT_ARTIFACT_PATTERN.test(value) || /^page\s+\d+\b/i.test(value.trim()) || /^image\s+\d+\b/i.test(value.trim());
}

function isWeakQuizQuestionText(question: string, answer: string, explanation: string) {
  const combined = `${question}\n${answer}\n${explanation}`;
  return (
    GENERIC_QUESTION_PATTERN.test(question.trim()) ||
    isImportArtifactText(answer) ||
    isImportArtifactText(explanation) ||
    /\b(this option does not match|different idea from the source material)\b/i.test(combined)
  );
}

function normalizeQuestion(item: unknown) {
  const record = asRecord(item);
  const question = stringValue(record.question) || stringValue(record.prompt);
  let options = optionArray(record.options || record.choices || record.answers);
  const optionRecords = Array.isArray(record.options || record.choices || record.answers)
    ? ((record.options || record.choices || record.answers) as unknown[])
    : [];
  let correctIndex = optionRecords.findIndex((option) => {
    const optionRecord = asRecord(option);
    return optionRecord.correct === true || optionRecord.isCorrect === true || optionRecord.is_correct === true;
  });
  if (correctIndex < 0 && typeof record.correctAnswerIndex === "number") correctIndex = record.correctAnswerIndex;
  if (correctIndex < 0 && typeof record.correctIndex === "number") correctIndex = record.correctIndex;
  if (correctIndex < 0 && typeof record.answerIndex === "number") correctIndex = record.answerIndex;

  let answer =
    stringValue(record.answer) ||
    stringValue(record.correctAnswer) ||
    stringValue(record.correct_answer) ||
    stringValue(record.correct);
  const letterIndex = indexFromLetter(answer || record.answer || record.correctAnswer || record.correct);
  if (correctIndex < 0 && letterIndex >= 0) correctIndex = letterIndex;

  if (correctIndex >= 0 && options[correctIndex]) answer = options[correctIndex];
  const answerIndex = options.findIndex((option) => option.toLowerCase() === answer.toLowerCase());
  if (answerIndex >= 0) correctIndex = answerIndex;

  if (options.length > 4) {
    const correctOption = correctIndex >= 0 && options[correctIndex] ? options[correctIndex] : answer;
    options = [correctOption, ...options.filter((option) => option !== correctOption)].filter(Boolean).slice(0, 4);
    correctIndex = correctOption ? options.findIndex((option) => option.toLowerCase() === correctOption.toLowerCase()) : -1;
  }

  if (!answer && correctIndex >= 0 && options[correctIndex]) answer = options[correctIndex];
  if (!question || options.length !== 4 || !answer || correctIndex < 0) return null;
  const randomized = shuffledOptions(question, options, answer);
  const explanation = stringValue(record.explanation) || stringValue(record.reason) || "Review the source material for the reasoning.";
  const repairedQuestion = completeTrailingQuestionWord(question, `${answer} ${randomized.answer} ${options.join(" ")} ${explanation}`);
  return {
    type: "mcq" as const,
    question: repairedQuestion,
    options: randomized.options,
    answer: randomized.answer,
    explanation,
    hint:
      stringValue(record.hint) ||
      stringValue(record.clue) ||
      stringValue(record.tip) ||
      "Eliminate choices that do not match the key terms from the source material.",
    acceptableAnswers: Array.from(
      new Set([answer, randomized.answer, ...stringArray(record.acceptableAnswers || record.acceptable_answers || record.aliases)]),
    ).filter(Boolean),
  };
}

function isUsableNormalizedQuestion(question: NonNullable<ReturnType<typeof normalizeQuestion>>) {
  return !isWeakQuizQuestionText(question.question, question.answer, question.explanation) && !question.options.some(isImportArtifactText);
}

function normalizeQuizPayload(payload: unknown, requestedCount: number) {
  const raw = asRecord(payload);
  const source = Array.isArray(raw.questions)
    ? raw.questions
    : Array.isArray(raw.quiz)
      ? raw.quiz
      : Array.isArray(raw.items)
        ? raw.items
        : Array.isArray(payload)
          ? payload
          : [];
  const questions = [];
  for (const item of source) {
    const question = normalizeQuestion(item);
    if (!question || !isUsableNormalizedQuestion(question)) continue;
    questions.push(question);
    if (questions.length >= requestedCount) break;
  }
  const warning =
    questions.length < requestedCount
      ? `The source material only supports ${questions.length} multiple-choice questions right now, so I created ${questions.length} instead of ${requestedCount}.`
      : null;
  return { questions, warning };
}

function compactSourceForQuiz(source: string) {
  return source
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[[^\]]+]\([^)]+\)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 80000);
}

function buildAvoidBlock(avoidQuestions: string[]) {
  const unique = Array.from(new Set(avoidQuestions.map((question) => question.trim()).filter(Boolean))).slice(-120);
  if (unique.length === 0) return "No previous questions in this generation batch.";
  return unique.map((question, index) => `${index + 1}. ${question}`).join("\n");
}

function buildQuizMessages({
  source,
  count,
  languagePrompt,
  languageLabel,
  avoidQuestions,
}: {
  source: string;
  count: number;
  languagePrompt: string;
  languageLabel: string;
  avoidQuestions: string[];
}) {
  return [
    {
      role: "system" as const,
      content:
        `You create original formative quizzes. Return valid JSON only. Every question must be type mcq with exactly four options. Use only the supplied material. ${languagePrompt}`,
    },
    {
      role: "user" as const,
      content: `Output language: ${languageLabel}
Create up to ${count} multiple-choice quiz questions from this material.

Important generation style:
- First mentally break the material into atomic study facts.
- Treat each definition, label, function, table row, graph axis, curve meaning, diagram annotation, formula variable, process step, comparison, cause/effect, example, exception, and vocabulary term as its own small concept.
- Ask one narrow question for each fact when possible.
- Prefer many focused questions over a few broad questions.
- Do not merge unrelated facts into one question.
- Do not ask about import/layout artifacts such as "each section has a corresponding image", "brief description", "source visual", page labels, uploaded image names, or AI vision safety labels.
- Continue into facts that were not covered by previous batches.
- If the requested count is higher than the true facts in the material, return only the useful unique questions you can support.

Avoid repeating these already generated questions:
${buildAvoidBlock(avoidQuestions)}

Each item needs type:"mcq", question, options with exactly 4 choices, answer that exactly matches one option, hint, acceptableAnswers, and explanation.
Make incorrect choices plausible but clearly wrong. Vary the correct option position.

Hint rules:
- The hint should guide memory without giving away the answer.
- acceptableAnswers should include short typed-answer variants a learner might enter.

Return this exact JSON shape:
{"questions":[{"type":"mcq","question":"string","options":["choice","choice","choice","choice"],"answer":"one exact option","hint":"short clue","acceptableAnswers":["short answer variant"],"explanation":"string"}]}

Material:
${source}`,
    },
  ];
}

function cleanFactLine(value: string) {
  return value
    .replace(/^(?:[-*\u2022]|\d+[.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

type FallbackFact = {
  text: string;
  topic: string;
};

function isHeadingLikeFact(value: string) {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 14) return false;
  if (/[.!?]$/.test(value)) return false;
  if (
    /\b(is|are|means|refers|occurs|happens|states|shows|illustrates|explains|involves|uses|used|determines|carries|receives|pumps|controls|facilitates|causes|leads|includes|requires|produces|allocates)\b/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/^diagram|^graph|^chart|^table|^visual/i.test(value)) return false;
  const titleLikeWords = words.filter((word) => /^[A-Z0-9"'(]/.test(word));
  return titleLikeWords.length >= Math.max(2, Math.ceil(words.length * 0.55));
}

function splitFactParts(value: string) {
  const parts = [value];
  if (value.length > 120) parts.push(...value.split(/(?<=[.!?])\s+/).map(cleanFactLine));
  if (value.length > 160) parts.push(...value.split(/;|\s+-\s+|\s+\|\s+/).map(cleanFactLine));
  return parts;
}

function factKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function displayTopic(topic: string) {
  const clean = topic.trim();
  if (!clean) return "";
  const colon = clean.match(/^([^:]{3,80}):\s*(.+)$/);
  return (colon?.[1] || clean).trim();
}

function isWeakFact(value: string) {
  return (
    value.length < 24 ||
    value.length > 300 ||
    isImportArtifactText(value) ||
    /^(source visual|page \d+$|image \d+$|notes?$|summary$|generated material)$/i.test(value) ||
    /^img[_\s-]?\d+.*study guide$/i.test(value) ||
    /^this study guide covers\b/i.test(value)
  );
}

function extractFallbackFacts(source: string, limit: number, avoidQuestions: string[]) {
  const avoided = new Set(avoidQuestions.map((question) => question.toLowerCase()));
  const candidates: FallbackFact[] = [];
  let currentTopic = "";

  for (const rawLine of source.replace(/\r/g, "").split(/\n+/)) {
    const clean = cleanFactLine(rawLine);
    if (!clean) continue;
    if (isHeadingLikeFact(clean)) {
      currentTopic = clean;
      continue;
    }

    for (const part of splitFactParts(clean)) {
      if (isWeakFact(part)) continue;
      if (isHeadingLikeFact(part)) continue;
      const lowered = part.toLowerCase();
      if ([...avoided].some((question) => question.includes(lowered.slice(0, 80)) || lowered.includes(question.slice(0, 80)))) continue;
      candidates.push({ text: part, topic: currentTopic });
    }
  }

  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    const key = factKey(candidate.text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, Math.max(limit, 1));
}

function shortSubject(fact: FallbackFact | string) {
  const text = typeof fact === "string" ? fact : fact.text;
  const topic = typeof fact === "string" ? "" : displayTopic(fact.topic);
  const colon = text.match(/^([^:]{3,80}):\s*(.+)$/);
  if (colon && !/^diagram|graph|chart|table|visual$/i.test(colon[1].trim())) return cleanQuestionFragment(colon[1]);
  if (/^diagram|^graph|^chart|^table|^visual/i.test(text)) return topic || "this visual";
  if (/^(it|this|these|they|each|the diagram|the graph|the chart)\b/i.test(text)) return topic || "this concept";
  const statement = text.match(/^(.{3,90}?)\s+(is|are|means|refers to|occurs when|happens when|states that|shows|illustrates|explains)\b/i);
  if (statement) return cleanQuestionFragment(statement[1]);
  const firstPhrase = cleanQuestionFragment(text.split(/[.:;]/)[0], 80);
  return firstPhrase && !/^(it|this|these|they|each)\b/i.test(firstPhrase) ? firstPhrase : topic;
}

function buildFallbackQuestionText(fact: FallbackFact) {
  const text = fact.text;
  const topic = displayTopic(fact.topic);
  const colon = text.match(/^([^:]{3,80}):\s*(.+)$/);
  if (colon && !/^diagram|graph|chart|table|visual$/i.test(colon[1].trim())) {
    return topic ? `What is noted about "${colon[1].trim()}" in ${topic}?` : `What does "${colon[1].trim()}" describe in the notes?`;
  }
  const subject = shortSubject(fact);
  if (/^it involves\b/i.test(text)) {
    return `Which concept is included in ${subject || topic || "this topic"}?`;
  }
  if (/\b(graph|chart|curve|axis|diagram|visual|flowchart|table)\b/i.test(text)) {
    const focus = answerFocus(text, subject || topic);
    return `Which visual detail shows "${focus || subject || "this concept"}"?`;
  }
  if (/\b(difference|compare|whereas|while|however|but)\b/i.test(text)) {
    return `Which comparison is correct for ${subject || "this topic"}?`;
  }
  if (/\b(cause|causes|because|therefore|effect|results?|leads to)\b/i.test(text)) {
    return `Which cause-and-effect statement matches ${subject || "the notes"}?`;
  }
  return `Which statement correctly describes ${subject || "this study fact"}?`;
}

function buildFallbackHint(fact: FallbackFact) {
  const subject = shortSubject(fact);
  const text = fact.text;
  const focus = answerFocus(text, subject);
  if (/\b(graph|chart|curve|axis)\b/i.test(text)) {
    return `Use the visual clue: compare the axes, curve direction, and what changes over time.`;
  }
  if (/\b(diagram|visual|flowchart|table)\b/i.test(text)) {
    return `Use the labels and arrows in the visual; the key clue is about "${focus}".`;
  }
  if (/\b(price|quantity demanded|quantity supplied|demand|supply)\b/i.test(text)) {
    return `Watch how price and quantity move; demand and supply do not move the same way.`;
  }
  if (/\b(limited resources|unlimited wants|scarcity)\b/i.test(text)) {
    return `Look for the idea of limited resources being used to satisfy unlimited wants.`;
  }
  if (/\b(opportunity cost|next best alternative)\b/i.test(text)) {
    return `The clue is what you give up when choosing one option over another.`;
  }
  if (/\b(cause|causes|because|therefore|effect|results?|leads to)\b/i.test(text)) {
    return `Find the option that keeps the cause and the result in the right order.`;
  }
  if (/\b(difference|compare|whereas|while|however|but)\b/i.test(text)) {
    return `Compare the two sides carefully; one option should keep both parts correct.`;
  }
  if (subject) return `Focus on the clue words "${focus}" and eliminate options about a different concept.`;
  return `Look for the option built around "${focus}".`;
}

function answerFocus(answer: string, subject = "") {
  const cleaned = answer
    .replace(/^diagram:\s*/i, "")
    .replace(/^([^:]{3,80}):\s*/, "")
    .replace(/["'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const subjectWords = new Set(
    subject
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff-]/gi, ""))
      .filter(Boolean),
  );
  const stopWords = new Set([
    "about",
    "after",
    "also",
    "because",
    "before",
    "between",
    "concept",
    "diagram",
    "different",
    "does",
    "from",
    "have",
    "into",
    "notes",
    "shows",
    "study",
    "that",
    "their",
    "there",
    "these",
    "this",
    "through",
    "used",
    "when",
    "where",
    "which",
    "with",
  ]);
  const words = cleaned
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9\u00c0-\u024f\u4e00-\u9fff-]/gi, ""))
    .filter((word) => word.length > 3 && !stopWords.has(word.toLowerCase()) && !subjectWords.has(word.toLowerCase()));
  return words.slice(0, 5).join(" ") || truncateAtWord(cleaned, 60) || "this fact";
}

function uniqueQuestionText(baseQuestion: string, fact: FallbackFact, usedQuestions: Set<string>) {
  if (!usedQuestions.has(baseQuestion.toLowerCase())) return baseQuestion;
  const subject = shortSubject(fact) || displayTopic(fact.topic) || "this topic";
  const focus = answerFocus(fact.text, subject);
  const variants = [
    `Which detail about ${subject} focuses on "${focus}"?`,
    `What should you remember about ${subject} related to "${focus}"?`,
    `Which source fact connects ${subject} to "${focus}"?`,
  ];
  return variants.find((variant) => !usedQuestions.has(variant.toLowerCase())) || `${variants[0]} (${usedQuestions.size + 1})`;
}

function fallbackQuestionsFromSource(source: string, requestedCount: number, avoidQuestions: string[]) {
  const facts = extractFallbackFacts(source, Math.min(requestedCount * 3, MAX_QUIZ_QUESTIONS * 3), avoidQuestions);
  if (facts.length < 2) return [];
  const existingQuestionKeys = new Set(avoidQuestions.map((question) => question.trim().toLowerCase()));
  const questions = [];
  for (let index = 0; index < facts.length && questions.length < requestedCount; index += 1) {
    const fact = facts[index];
    const answer = fact.text;
    const question = uniqueQuestionText(buildFallbackQuestionText(fact), fact, existingQuestionKeys);
    if (isWeakQuizQuestionText(question, answer, answer)) continue;
    const distractors = facts
      .filter((candidate) => candidate !== fact && shortSubject(candidate).toLowerCase() !== shortSubject(fact).toLowerCase())
      .slice(index + 1)
      .concat(facts.filter((candidate) => candidate !== fact).slice(0, index + 1))
      .map((candidate) => candidate.text)
      .filter((candidate) => !isImportArtifactText(candidate))
      .slice(0, 3);
    while (distractors.length < 3) {
      distractors.push(
        distractors.length % 2 === 0
          ? "This option does not match the selected concept from the notes."
          : "This option describes a different idea from the source material.",
      );
    }
    const randomized = shuffledOptions(question, [answer, ...distractors], answer);
    existingQuestionKeys.add(question.toLowerCase());
    questions.push({
      type: "mcq" as const,
      question,
      options: randomized.options,
      answer: randomized.answer,
      hint: buildFallbackHint(fact),
      acceptableAnswers: [answer, shortSubject(fact)].filter(Boolean),
      explanation: answer,
    });
  }
  return questions;
}

export async function POST(request: Request) {
  const { user, response } = await requireApiUser();
  if (!user) return response;

  const parsed = quizGenerateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message || "Invalid quiz request.", 422);

  let source = parsed.data.notes || "";
  if (parsed.data.deckId) {
    const deck = await prisma.deck.findFirst({
      where: { id: parsed.data.deckId, userId: user.id },
      include: { cards: true },
    });
    if (!deck) return jsonError("Deck not found.", 404, "DECK_NOT_FOUND");
    source = deck.cards.map((card) => `Q: ${card.question}\nA: ${card.answer}`).join("\n\n");
  }
  source = compactSourceForQuiz(source);

  const mode = (parsed.data.modelMode || user.setting?.aiModelMode || "auto-free") as ModelMode;
  const manualModel = parsed.data.manualModel || user.setting?.manualModel;
  const language = studyLanguageInstruction(user.setting?.studyLanguage);

  if (parsed.data.fastFacts) {
    const questions = fallbackQuestionsFromSource(source, parsed.data.count, parsed.data.avoidQuestions);
    if (questions.length === 0) {
      return jsonError("The source material did not produce usable multiple-choice questions. Try regenerating notes with more detail.", 422, "INSUFFICIENT_SOURCE");
    }
    const warning =
      questions.length < parsed.data.count
        ? `The source material supports ${questions.length} unique atomic fact questions right now, so I created ${questions.length} instead of ${parsed.data.count}.`
        : null;
    const checked = quizResponseSchema.safeParse({ questions, warning });
    if (!checked.success) return jsonError("The model returned quiz JSON in an unexpected shape.", 502, "MALFORMED_JSON");
    return NextResponse.json({
      ...checked.data,
      requestedCount: parsed.data.count,
      generatedCount: checked.data.questions.length,
      maximumSupported: checked.data.questions.length,
      warning,
      mode: "fast-facts",
    });
  }

  try {
    await enforceAiCooldown(user.id, "quiz", 1);
    const payload = await generateJson<unknown>({
      mode,
      manualModel,
      userId: user.id,
      repairInstruction: "Convert the response into {\"questions\":[...]} with valid quiz JSON.",
      messages: buildQuizMessages({
        source,
        count: parsed.data.count,
        languagePrompt: language.prompt,
        languageLabel: language.label,
        avoidQuestions: parsed.data.avoidQuestions,
      }),
    });
    let normalized = normalizeQuizPayload(payload, parsed.data.count);
    if (normalized.questions.length === 0) {
      const fallbackQuestions = fallbackQuestionsFromSource(source, parsed.data.count, parsed.data.avoidQuestions);
      normalized = {
        questions: fallbackQuestions,
        warning:
          fallbackQuestions.length > 0
            ? "The free model did not return usable quiz JSON, so StudyForge created source-backed fact questions instead."
            : null,
      };
    }
    if (normalized.questions.length === 0) {
      return jsonError("The source material did not produce usable multiple-choice questions. Try regenerating notes with more detail.", 422, "INSUFFICIENT_SOURCE");
    }
    const checked = quizResponseSchema.safeParse(normalized);
    if (!checked.success) return jsonError("The model returned quiz JSON in an unexpected shape.", 502, "MALFORMED_JSON");
    return NextResponse.json({
      ...checked.data,
      requestedCount: parsed.data.count,
      generatedCount: checked.data.questions.length,
      maximumSupported: checked.data.questions.length,
      warning: normalized.warning,
    });
  } catch (error) {
    const aiError = error as OpenRouterError;
    return jsonError(aiError.message, aiError.status || 500, aiError.code || "AI_ERROR");
  }
}
