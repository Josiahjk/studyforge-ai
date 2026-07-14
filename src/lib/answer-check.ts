const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

export type AnswerCheckResult = {
  correct: boolean;
  confidence: number;
  reason: string;
};

export function normalizeAnswer(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function answerTokens(value: string) {
  return normalizeAnswer(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function tokenOverlap(userAnswer: string, expectedAnswer: string) {
  const userTokens = new Set(answerTokens(userAnswer));
  const expectedTokens = new Set(answerTokens(expectedAnswer));
  if (userTokens.size === 0 || expectedTokens.size === 0) return 0;
  let matches = 0;
  for (const token of userTokens) {
    if (expectedTokens.has(token)) matches += 1;
  }
  return matches / Math.max(1, expectedTokens.size);
}

function tokenIndex(tokens: string[], aliases: string[]) {
  return tokens.findIndex((token, index) => aliases.some((alias) => {
    const aliasTokens = alias.split(" ");
    return aliasTokens.every((aliasToken, aliasIndex) => tokens[index + aliasIndex] === aliasToken);
  }));
}

function firstConceptIndex(tokens: string[], aliases: string[]) {
  const indexes = aliases
    .map((alias) => tokenIndex(tokens, alias.split("|")))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function answerConcepts(value: string) {
  const text = normalizeAnswer(value);
  const concepts = new Set<string>();
  const checks: Array<[string, RegExp]> = [
    ["ram", /\b(?:ram|random access memory)\b/],
    ["rom", /\b(?:rom|read only memory)\b/],
    ["temporary", /\b(?:temporary|temporarily|volatile|short term|loses?|lost|clears?|temporary storage)\b/],
    ["permanent", /\b(?:permanent|permanently|non volatile|nonvolatile|retains?|keeps?|saved|firmware|read only|without power)\b/],
    ["input", /\b(?:input|enter|send|give|capture)\b/],
    ["output", /\b(?:output|display|print|send out|processed data)\b/],
    ["hardware", /\b(?:hardware|physical|device|component)\b/],
    ["software", /\b(?:software|program|application|system software)\b/],
  ];
  for (const [concept, pattern] of checks) {
    if (pattern.test(text)) concepts.add(concept);
  }
  return concepts;
}

function ramRomContrastMatch(userAnswer: string, expectedAnswer: string) {
  const expectedConcepts = answerConcepts(expectedAnswer);
  if (!expectedConcepts.has("ram") || !expectedConcepts.has("rom")) return false;
  if (!expectedConcepts.has("temporary") || !expectedConcepts.has("permanent")) return false;

  const userTokens = normalizeAnswer(userAnswer).split(" ").filter(Boolean);
  const ramIndex = firstConceptIndex(userTokens, ["ram", "random access memory"]);
  const romIndex = firstConceptIndex(userTokens, ["rom", "read only memory"]);
  const temporaryIndex = firstConceptIndex(userTokens, [
    "temporary",
    "temporarily",
    "volatile",
    "short term",
    "loses",
    "lose",
    "lost",
    "clears",
  ]);
  const permanentIndex = firstConceptIndex(userTokens, [
    "permanent",
    "permanently",
    "non volatile",
    "nonvolatile",
    "retains",
    "retain",
    "keeps",
    "keep",
    "saved",
    "firmware",
    "read only",
  ]);

  if (ramIndex < 0 || romIndex < 0 || temporaryIndex < 0 || permanentIndex < 0) return false;

  if (ramIndex < romIndex) {
    return temporaryIndex > ramIndex && temporaryIndex < romIndex && permanentIndex > romIndex;
  }
  return permanentIndex > romIndex && permanentIndex < ramIndex && temporaryIndex > ramIndex;
}

function conceptCoverage(userAnswer: string, expectedAnswer: string) {
  const expectedConcepts = answerConcepts(expectedAnswer);
  if (
    expectedConcepts.has("ram") &&
    expectedConcepts.has("rom") &&
    expectedConcepts.has("temporary") &&
    expectedConcepts.has("permanent")
  ) {
    return ramRomContrastMatch(userAnswer, expectedAnswer) ? 1 : 0;
  }
  const userConcepts = answerConcepts(userAnswer);
  if (expectedConcepts.size === 0) return 0;
  let matches = 0;
  for (const concept of expectedConcepts) {
    if (userConcepts.has(concept)) matches += 1;
  }
  return matches / expectedConcepts.size;
}

function compact(value: string) {
  return normalizeAnswer(value).replace(/\s+/g, "");
}

export function checkTypedAnswer(userAnswer: string, expectedAnswer: string, acceptableAnswers: string[] = []): AnswerCheckResult {
  const normalizedUser = normalizeAnswer(userAnswer);
  const candidates = [expectedAnswer, ...acceptableAnswers].map(normalizeAnswer).filter(Boolean);
  if (!normalizedUser) return { correct: false, confidence: 0, reason: "No answer entered." };

  for (const candidate of candidates) {
    if (normalizedUser === candidate) {
      return { correct: true, confidence: 1, reason: "Exact match." };
    }
  }

  for (const candidate of candidates) {
    if (ramRomContrastMatch(normalizedUser, candidate)) {
      return { correct: true, confidence: 0.92, reason: "Correct RAM/ROM contrast." };
    }

    const userCompact = compact(normalizedUser);
    const candidateCompact = compact(candidate);
    if (userCompact.length >= 3 && candidateCompact.length >= 3 && userCompact === candidateCompact) {
      return { correct: true, confidence: 0.98, reason: "Matches after spacing and punctuation cleanup." };
    }
    const shorter = Math.min(userCompact.length, candidateCompact.length);
    const longer = Math.max(userCompact.length, candidateCompact.length);
    if (
      shorter >= 5 &&
      longer > 0 &&
      shorter / longer >= 0.72 &&
      (userCompact.includes(candidateCompact) || candidateCompact.includes(userCompact))
    ) {
      return { correct: true, confidence: 0.86, reason: "Close phrase match." };
    }
  }

  const bestOverlap = Math.max(0, ...candidates.map((candidate) => tokenOverlap(normalizedUser, candidate)));
  if (bestOverlap >= 0.72) {
    return { correct: true, confidence: bestOverlap, reason: "Key terms match." };
  }

  const bestConceptCoverage = Math.max(0, ...candidates.map((candidate) => conceptCoverage(normalizedUser, candidate)));
  if (bestConceptCoverage >= 0.7) {
    return { correct: true, confidence: bestConceptCoverage, reason: "Key ideas match with accepted wording." };
  }

  return { correct: false, confidence: Math.max(bestOverlap, bestConceptCoverage), reason: "Missing important answer terms." };
}
