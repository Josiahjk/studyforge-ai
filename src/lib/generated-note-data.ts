export type GeneratedNoteItem = {
  heading: string;
  explanation: string;
  bullets: string[];
  sourceChunkIds: string[];
  pageNumber?: number;
};

export type GeneratedFlashcardItem = {
  question: string;
  answer: string;
  difficulty: "easy" | "medium" | "hard";
  sourceChunkIds: string[];
};

export type GeneratedQuizItem = {
  question: string;
  choices: string[];
  correctAnswerIndex: number;
  explanation: string;
  hint?: string;
  answer?: string;
  acceptableAnswers?: string[];
  sourceChunkIds: string[];
};

export type SourceChunkForNotes = {
  id: string;
  chunkIndex: number;
  pageNumber?: number | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  heading?: string | null;
  cleanedText: string;
};

type VisionSection = {
  pageNumber?: number;
  title: string;
  text: string;
  chunk: SourceChunkForNotes;
};

const LABEL_ONLY_PATTERN =
  /^(important text|extracted text|important extracted text|diagram\/layout|diagrams, layout, and labels|diagrams, charts, and labels explained|clear page summary|diagram explanation|diagram|diagram or visual walkthrough|table explanation|table|summary|study notes|study-note paragraph|key study points|list of functions|stages|definitions|types of food groups|list of functions|theory points|results|happens because|as a result|digestion types|plant transport|readability|quiz ideas|flashcard ideas|preserve important terms|key factors|labels in the graph)\s*:?\s*$/i;

const GENERIC_HEADING_PATTERN =
  /^(explanation|preserve important terms|quiz ideas|flashcard ideas|important text|important extracted text|extracted text|study notes|summary|readability)(?:,\s*(?:explanation|preserve important terms|quiz ideas|flashcard ideas|important text|study notes|summary|readability))*$/i;

function stripLabelPrefix(line: string) {
  return line
    .replace(/^(important text|extracted text|important extracted text|preserve important terms|study notes|study-note paragraph|summary|clear page summary|explanation)\s*:?\s*/i, "")
    .trim();
}

function stripBoilerplate(line: string) {
  return stripLabelPrefix(line)
    .replace(/^(?:The|This) page explains\s+/i, "Study ")
    .replace(/^(?:The|This) page (?:outlines|details|lists|features)\s+/i, "Learn ")
    .replace(/^The page (?:explains|illustrates|describes|lists|provides an overview of|outlines|details|features|introduces|visually demonstrates)\s+/i, "")
    .replace(/^Page\s+\d+\s+(?:explains|illustrates|describes|lists|provides an overview of|outlines|details|features|introduces|visually demonstrates)\s+/i, "")
    .replace(/^This page (?:explains|illustrates|describes|lists|provides an overview of|outlines|details|features|introduces|visually demonstrates)\s+/i, "")
    .replace(/^This section (?:explains|illustrates|describes|lists|provides an overview of|outlines|details|features|introduces)\s+/i, "")
    .replace(/^Explains\s+(?:how|the)\s+/i, "")
    .replace(/^Lists\s+the\s+/i, "")
    .replace(/^Review the\s+/i, "")
    .replace(/\s+for easy review\.?$/i, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulStudyLine(line: string) {
  if (!line || LABEL_ONLY_PATTERN.test(line)) return false;
  if (/^(quiz ideas|flashcard ideas|front|back|readability)\s*:?/i.test(line)) return false;
  if (/^n\/a\b/i.test(line)) return false;
  if (/^(text is clear|no blurry|no major blurry|typed text is clear|handwritten graph labels are readable)/i.test(line)) return false;
  if (/^(this page has|biology section|chemistry section|there are no diagrams|no diagrams|readability)/i.test(line)) return false;
  const cleaned = stripBoilerplate(line);
  if (!cleaned || LABEL_ONLY_PATTERN.test(cleaned)) return false;
  if (/\blikely\b/i.test(cleaned)) return false;
  if (/^(what|which|how|why|define|list|give|classify|name|does|based on)\b.*\?$/i.test(cleaned)) return false;
  if (/^in the .+\b(which|what|how|why)\b/i.test(cleaned)) return false;
  return true;
}

export function parseGeneratedArray<T>(value: string, fallback: T[] = []) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function sentenceCase(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
}

function titleFromFileName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? `${sentenceCase(base)} Study Guide` : "Imported Study Guide";
}

function cleanStudyLine(line: string) {
  return line
    .replace(/^PDF page \d+ image OCR:\s*/i, "")
    .replace(/^AI vision analysis for .*?:\s*/i, "")
    .replace(/^Selected frame AI vision analysis for .*?:\s*/i, "")
    .replace(/^Fallback text extraction for .*?:\s*/i, "")
    .replace(/^NO_READABLE_TEXT$/i, "")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*]|\d+[.)])\s*/, "")
    .replace(/\*{1,3}/g, "")
    .replace(/_{1,3}/g, "")
    .replace(/`/g, "")
    .replace(/Ã¢â€ â€™|â†’/g, "->")
    .replace(/Ã¢â‚¬â€œ|â€“|â€”/g, "-")
    .replace(/Ã¢â‚¬â„¢|â€™/g, "'")
    .replace(/â€œ|â€�/g, "\"")
    .replace(/Ã¢â‚¬Â¢|â€¢/g, "-")
    .replace(/Ã¢â€”Â/g, "-")
    .replace(/Ã¢â€“Âª/g, "-")
    .replace(/â|â/g, "\"")
    .replace(/â/g, "'")
    .replace(/â|â/g, "-")
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/ÎH/g, "delta H")
    .replace(/ΔH/g, "delta H")
    .replace(/\$\\rightarrow\$/g, "->")
    .replace(/\\rightarrow/g, "->")
    .replace(/[→]/g, "->")
    .replace(/[\u2022\u25cf\u25aa\u25cb\u25a0\u25b6\u27a2\u2605]/g, "-")
    .replace(/^[#\-\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inlineStudyLineCandidates(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[\u2022\u25cf\u25aa\u25cb\u25a0\u25b6\u27a2\u2605]/g, "\n- ")
    .replace(/\s+(Advantages|Disadvantages)\s*:\s*/gi, "\n$1: ")
    .replace(/\s+(\d+\s+TYPES?\s+OF\s+[A-Z][A-Z\s]{2,})\s*:?\s*/g, "\n$1: ")
    .replace(/\s+(TYPES?\s+OF\s+[A-Z][A-Z\s]{2,})\s*/g, "\n$1 ")
    .split(/\n+/)
    .flatMap((line) => {
      const cleaned = line.trim();
      if (cleaned.length <= 170) return [cleaned];
      return cleaned
        .split(/\s+-\s+(?=[A-Z][A-Za-z0-9 (&/'’.-]{2,70}(?:\s+-|\s*:|\s*$))/)
        .map((part, index) => (index === 0 ? part : `- ${part}`));
    })
    .map(cleanStudyLine)
    .filter((line) => line.length >= 3);
}

function cleanInlineHeadingCandidate(value: string) {
  const cleaned = cleanStudyLine(value)
    .replace(/\s+HARDW ARE\b/i, " Hardware")
    .replace(/\s+SOFTW ARE\b/i, " Software")
    .replace(/\s+/g, " ")
    .trim();
  const duplicateTail = /^(.+\b([A-Za-z]{4,})\b)\s+\2$/i.exec(cleaned);
  if (duplicateTail?.[1]) return sentenceCase(duplicateTail[1]);
  const ampersandDuplicateTail = /^(.+&.+)\s+\b([A-Za-z]{4,})\b$/i.exec(cleaned);
  if (ampersandDuplicateTail?.[1] && ampersandDuplicateTail[1].toLowerCase().includes(ampersandDuplicateTail[2].toLowerCase())) {
    return sentenceCase(ampersandDuplicateTail[1]);
  }
  return sentenceCase(cleaned);
}

function leadingTopicFromInline(text: string) {
  const candidates = inlineStudyLineCandidates(text);
  const explicit = candidates
    .map((line) => /^([A-Z][A-Za-z0-9 &/()'’.-]{3,72})\s+-\s+/.exec(line)?.[1]?.trim())
    .find((value) => value && !LABEL_ONLY_PATTERN.test(value));
  if (explicit) return cleanInlineHeadingCandidate(explicit);

  const first = candidates.find((line) => line.length >= 4 && line.length <= 80 && !line.includes(":"));
  if (first && isTopicHeading(first)) return cleanInlineHeadingCandidate(first);

  const cleaned = cleanStudyLine(text);
  const match = /^([A-Z][A-Za-z0-9 &/()'’.-]{3,72})\s+-\s+/.exec(cleaned);
  return match?.[1] ? cleanInlineHeadingCandidate(match[1]) : "";
}

function headingFromChunk(chunk: SourceChunkForNotes) {
  const storedHeading = cleanStudyLine(chunk.heading || "");
  if (storedHeading) return sentenceCase(storedHeading);
  const inlineHeading = leadingTopicFromInline(chunk.cleanedText);
  if (inlineHeading) return inlineHeading;
  const lines = chunk.cleanedText.split(/\n+/).map(cleanStudyLine).filter((line) => line.length >= 3);
  const titleLike = lines.find((line) => line.length <= 90 && /[A-Za-z]/.test(line));
  return titleLike ? sentenceCase(titleLike) : `Page ${chunk.pageNumber || chunk.chunkIndex + 1} Notes`;
}

function bulletLines(text: string) {
  const lines = inlineStudyLineCandidates(text)
    .map(cleanStudyLine)
    .filter((line) => line.length >= 8 && !LABEL_ONLY_PATTERN.test(line) && !/^PDF page \d+/i.test(line));
  const seen = new Set<string>();
  return lines.filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isWeakGeneratedNotes(title: string, summary: string, notes: GeneratedNoteItem[]) {
  const combined = `${title} ${summary}`.toLowerCase();
  const noteText = notes
    .map((note) => `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`)
    .join("\n")
    .toLowerCase();
  const hasRawAiArtifacts =
    noteText.includes("flashcard ideas") ||
    noteText.includes("quiz ideas") ||
    noteText.includes("this analysis covers the provided images") ||
    noteText.includes("ai vision analysis for");
  const hasRawVisionLabels =
    noteText.includes("**page") ||
    noteText.includes("study notes:") ||
    noteText.includes("extracted text:") ||
    noteText.includes("important extracted text") ||
    noteText.includes("preserve important terms") ||
    noteText.includes("this page explains") ||
    noteText.includes("this page provides") ||
    noteText.includes("this page illustrates");
  const pageHeadingCount = notes.filter((note) => /^page\s+\d+\s*:/i.test(note.heading)).length;
  const genericHeadingCount = notes.filter((note) =>
    GENERIC_HEADING_PATTERN.test(stripPagePrefix(note.heading) || note.heading),
  ).length;
  const hasHeadingContentMismatch = notes.some((note) => {
    const text = `${note.explanation}\n${note.bullets.join("\n")}`;
    return /^catalyst$/i.test(note.heading) && /increased concentration|concentration\s*\/\s*pressure|increasing surface area/i.test(text);
  });
  return (
    notes.length === 0 ||
    hasRawAiArtifacts ||
    hasHeadingContentMismatch ||
    genericHeadingCount > 0 ||
    pageHeadingCount >= Math.max(2, Math.ceil(notes.length * 0.5)) ||
    (notes.length <= 4 &&
      (combined.includes("**page") ||
        combined.includes("this study guide covers page 1") ||
        combined.includes("this study guide covers **page") ||
        hasRawVisionLabels ||
        (noteText.includes("page 12") && notes.some((note) => /^page\s+\d+/i.test(note.heading))))) ||
    (notes.length <= 1 &&
      (combined.includes("sample document") ||
        combined.includes("brief overview of the content") ||
        combined.includes("summary generated from the uploaded document")))
  );
}

function headerPageNumbers(text: string) {
  const header = /^AI vision analysis for ([^\n:]+):/i.exec(text)?.[1] || "";
  return [...header.matchAll(/Page\s*(\d+)/gi)]
    .map((match) => Number(match[1]))
    .filter((pageNumber) => Number.isInteger(pageNumber) && pageNumber > 0);
}

function resolveVisionPageNumber(sectionPageNumber: number, headerPages: number[]) {
  if (
    headerPages.length > 0 &&
    !headerPages.includes(sectionPageNumber) &&
    sectionPageNumber >= 1 &&
    sectionPageNumber <= headerPages.length
  ) {
    return headerPages[sectionPageNumber - 1];
  }
  return sectionPageNumber;
}

function splitVisionSections(chunk: SourceChunkForNotes) {
  const rawText = chunk.cleanedText.replace(/\r/g, "\n");
  const headerPages = headerPageNumbers(rawText);
  const text = rawText
    .replace(/\r/g, "\n")
    .replace(/^AI vision analysis for[^\n]*:\s*/i, "")
    .replace(/^Selected frame AI vision analysis for[^\n]*:\s*/i, "")
    .trim();
  const regex = /(?:^|\n)(?:-{3,}\s*\n)?\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(Page\s*(\d+)(?:\s*\([^)\n]+\))?)(?:\*\*)?\s*:?\s*/gi;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) return [];

  return matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index || text.length : text.length;
      const sectionPageNumber = Number(match[2]);
      return {
        pageNumber: resolveVisionPageNumber(sectionPageNumber, headerPages),
        title: cleanStudyLine(match[1] || `Page ${match[2]}`),
        text: text.slice(start, end).trim(),
        chunk,
      };
    })
    .filter((section) => cleanStudyLine(section.text).length >= 20);
}

function normalizeStudyLine(line: string) {
  const cleaned = stripBoilerplate(
    cleanStudyLine(line)
    .replace(/^Study-note paragraph\s*:?\s*/i, "Summary: ")
    .replace(/^Key study points\s*:?\s*/i, "Key study points: ")
    .replace(/^Diagram or visual walkthrough\s*:?\s*/i, "Diagram: ")
    .replace(/^Important Text\s*:?\s*/i, "Important text: ")
    .replace(/^Extracted Text\s*:?\s*/i, "Extracted text: ")
    .replace(/^Important extracted text\s*:?\s*/i, "Important extracted text: ")
    .replace(/^Preserve important terms\s*:?\s*/i, "Preserve important terms: ")
    .replace(/^Diagram\/Layout Explanation\s*:?\s*/i, "Diagram/layout: ")
    .replace(/^Diagrams, layout, and labels\s*:?\s*/i, "Diagram/layout: ")
    .replace(/^Diagrams, charts, and labels explained\s*:?\s*/i, "Diagram/layout: ")
    .replace(/^Diagram Explanation\s*:?\s*/i, "Diagram: ")
    .replace(/^Table Explanation\s*:?\s*/i, "Table: ")
    .replace(/^Study Notes\s*:?\s*/i, "Study notes: ")
    .replace(/^Summary\s*:?\s*/i, "Summary: ")
    .trim(),
  );
  if (!isUsefulStudyLine(cleaned)) return "";
  return cleaned;
}

function sectionLines(text: string) {
  const seen = new Set<string>();
  return text
    .split(/\n+/)
    .map(normalizeStudyLine)
    .filter((line) => line.length >= 3)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function stripPagePrefix(value: string) {
  return value.replace(/^Page\s*\d+(?:\s*\([^)\n]+\))?\s*:\s*/i, "").trim();
}

function isTopicHeading(line: string) {
  const cleaned = stripBoilerplate(line);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const titleLikeWords = words.filter((word) => /^[A-Z][A-Za-z(),&/-]*$/.test(word) || /^(of|the|and|in|on|a|an|to|vs)$/i.test(word));
  const factorListItem = /^(concentration(?:\s*\([^)]+\))?|pressure(?:\s*\([^)]+\))?|surface area(?:\s*\([^)]+\))?|temperature|catalyst)$/i.test(cleaned);
  return (
    cleaned.length >= 3 &&
    cleaned.length <= 84 &&
    !cleaned.includes(":") &&
    !cleaned.includes("=") &&
    !/[.!?]$/.test(cleaned) &&
    !/^["']/.test(cleaned) &&
    !factorListItem &&
    words.length <= 8 &&
    titleLikeWords.length >= Math.max(1, Math.ceil(words.length * 0.7)) &&
    !LABEL_ONLY_PATTERN.test(cleaned) &&
    !GENERIC_HEADING_PATTERN.test(cleaned)
  );
}

function comparableLine(value: string) {
  return stripBoilerplate(value)
    .replace(/^(title|topic|graph|diagram\s*\d*|table)\s*:\s*/i, "")
    .toLowerCase()
    .replace(/[.!?:;"'`]+$/g, "")
    .trim();
}

function explicitHeadingValue(line: string) {
  const match = /^(title|topic|graph|diagram\s*\d*|table)\s*:\s*(.+)$/i.exec(line);
  const value = match?.[2]?.trim();
  return value && value.length <= 120 ? value : "";
}

function isExplicitHeading(line: string) {
  return Boolean(explicitHeadingValue(line));
}

function splitTopicGroups(lines: string[]) {
  const headingIndexes = lines
    .map((line, index) => (isExplicitHeading(line) || isTopicHeading(line) ? index : -1))
    .filter((index) => index >= 0);
  if (headingIndexes.length < 2) return [lines];

  return headingIndexes
    .map((start, index) => {
      const end = index + 1 < headingIndexes.length ? headingIndexes[index + 1] : lines.length;
      return lines.slice(start, end);
    })
    .filter((group) => group.length >= 2);
}

function normalizeSentence(value: string) {
  const cleaned = stripBoilerplate(value).replace(/\s+/g, " ").trim();
  if (!cleaned) return cleaned;
  const capitalized = `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function splitDefinitionLine(value: string) {
  const cleaned = normalizeSentence(value)
    .replace(/\.$/, "")
    .replace(/^\d+\.\s*/, "")
    .trim();
  const colonMatch = /^([^:]{2,78}):\s*(.+)$/i.exec(cleaned);
  const equalMatch = /^([^=]{2,78})=\s*(.+)$/i.exec(cleaned);
  const match = colonMatch || equalMatch;
  if (!match) return null;
  const term = cleanStudyLine(match[1]).replace(/\.$/, "").trim();
  const detail = cleanStudyLine(match[2]).replace(/^\.+$/, "").trim();
  if (!term || !detail || LABEL_ONLY_PATTERN.test(term) || GENERIC_HEADING_PATTERN.test(term)) return null;
  if (/^(right side|left side|legend|blood vessels|physical change|chemical change|leaf cross section|stem cross section)$/i.test(term)) {
    return null;
  }
  return { term: sentenceCase(term), detail: normalizeSentence(detail) };
}

function definitionLines(lines: string[]) {
  const seen = new Set<string>();
  return lines
    .map(splitDefinitionLine)
    .filter((item): item is { term: string; detail: string } => Boolean(item))
    .filter((item) => {
      const key = `${item.term.toLowerCase()}:${item.detail.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isEmptyGroupLabel(value: string) {
  const cleaned = cleanStudyLine(value).replace(/[:.\s]+$/, "").trim();
  return /^(right side|left side|legend|blood vessels|physical change|chemical change|leaf cross section|stem cross section|definitions|key factors)$/i.test(cleaned);
}

function containsAny(value: string, terms: string[]) {
  const lower = value.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function isHeartTopic(value: string) {
  return containsAny(value, ["heart anatomy", "heart structure", "vena cava", "right atrium", "right ventricle", "left atrium", "left ventricle", "aorta", "pulmonary artery"]);
}

function isFoodBreakdownTopic(heading: string, combined: string) {
  return (
    containsAny(heading, ["food breakdown", "stages of food breakdown"]) ||
    containsAny(combined, ["ingestion ->", "ingestion $", "assimilation -> egestion", "5 different stages"])
  );
}

function isAlimentaryCanalTopic(heading: string, combined: string) {
  return containsAny(`${heading}\n${combined}`, ["alimentary canal", "oesophagus", "salivary glands", "small intestine", "large intestine", "rectum", "anus"]);
}

function isReactionRateTopic(heading: string, combined: string) {
  return containsAny(`${heading}\n${combined}`, [
    "rate of reaction",
    "reaction rates",
    "factors affecting reaction",
    "increased concentration",
    "concentration/pressure",
    "concentration / pressure",
    "effect of temperature",
    "effect of catalyst",
  ]);
}

function buildHumanExplanation(heading: string, rawBullets: string[], fallback: string) {
  const combined = `${heading}\n${rawBullets.join("\n")}`.toLowerCase();
  const definitions = definitionLines(rawBullets);

  if (isHeartTopic(combined)) {
    return "Study the heart diagram as a blood-flow pathway, not as separate labels. The right side handles deoxygenated blood: it enters through the vena cava, moves into the right atrium, passes through a valve into the right ventricle, and is pumped to the pulmonary artery. The left side handles oxygenated blood: it returns from the lungs through the pulmonary vein, enters the left atrium, moves through a valve into the left ventricle, and is pumped out through the aorta. Use the color arrows as the main memory clue: blue for deoxygenated blood and red for oxygenated blood.";
  }

  if (isAlimentaryCanalTopic(heading, combined)) {
    return "Learn the alimentary canal as a journey from mouth to anus. Each organ has a job in moving food, breaking it down, absorbing useful nutrients, or removing waste. The important study pattern is sequence plus function: know where food goes next and what each organ adds to the digestion process.";
  }

  if (isFoodBreakdownTopic(heading, combined)) {
    return "Food breakdown is a step-by-step process. First food enters the body, then large insoluble molecules are chemically digested into small soluble molecules. Those molecules are absorbed into the blood, used by cells during assimilation, and any undigested material leaves the body through egestion.";
  }

  if (containsAny(combined, ["food groups", "carbohydrates", "protein", "lipid", "dietary fibre"])) {
    return "Food groups are easiest to remember by their main body role. Carbohydrates mainly supply energy, protein supports growth and repair, lipids store energy and insulate, fibre helps movement through the intestine, and vitamins, minerals, and water support healthy cell functions.";
  }

  if (containsAny(combined, ["physical digestion", "chemical digestion", "enzymes", "bile", "hydrochloric acid"])) {
    return "Digestion has two connected parts. Physical digestion makes food smaller without changing the molecules, which increases surface area for enzymes. Chemical digestion uses enzymes and digestive chemicals to turn large insoluble food molecules into small soluble molecules that can be absorbed.";
  }

  if (containsAny(combined, ["xylem", "phloem", "vascular bundle", "leaf cross section", "stem cross section"])) {
    return "For plant transport, focus on what each vascular tissue carries and where it is found in the diagram. Xylem moves water and minerals from the roots upward and also supports the plant. Phloem moves food made by photosynthesis from leaves to parts of the plant that need it. In cross-section diagrams, both tissues are grouped in vascular bundles.";
  }

  if (isReactionRateTopic(heading, combined)) {
    return "Reaction-rate graphs are read by comparing the steepness of the curves. A steeper curve means the reaction is faster because product forms more quickly. If the curves reach the same final plateau, the total amount of product is the same; only the speed has changed. Concentration, pressure, surface area, temperature, and catalysts all increase rate by making successful particle collisions happen more often or with lower activation energy.";
  }

  if (containsAny(combined, ["endothermic", "exothermic", "activation energy", "enthalpy", "bond breaking", "bond forming"])) {
    return "Energy pathway diagrams show whether a reaction absorbs or releases energy overall. In an endothermic reaction, more energy is absorbed in bond breaking than released in bond forming, so products end higher than reactants. In an exothermic reaction, more energy is released when bonds form, so products end lower than reactants.";
  }

  if (containsAny(combined, ["redox", "oxidation", "reduction"])) {
    return "A redox reaction always has oxidation and reduction happening together. In this oxygen-based definition, oxidation means oxygen is added, while reduction means oxygen is removed. Do not study them as isolated definitions: one substance being oxidised is paired with another being reduced.";
  }

  if (definitions.length >= 2) {
    const terms = definitions
      .slice(0, 4)
      .map((item) => `${item.term.toLowerCase()} (${item.detail.replace(/\.$/, "").toLowerCase()})`)
      .join(", ");
    return `${sentenceCase(heading)} is best studied as connected terms, not a memorised list. Focus on what each part does and how it supports the larger process: ${terms}.`;
  }

  return fallback || "Focus on the main idea, the important vocabulary, and how the details connect to the diagram or process shown in the source.";
}

function enrichStudyBullets(heading: string, rawBullets: string[]) {
  const combined = `${heading}\n${rawBullets.join("\n")}`.toLowerCase();
  const cleaned = rawBullets
    .map(normalizeSentence)
    .filter((line) => line.length >= 3)
    .filter((line) => !isEmptyGroupLabel(line));
  const extras: string[] = [];

  if (isHeartTopic(combined)) {
    extras.push("Flow to remember: vena cava -> right atrium -> right ventricle -> pulmonary artery -> lungs.");
    extras.push("Oxygenated flow: pulmonary vein -> left atrium -> left ventricle -> aorta -> body.");
    extras.push("Color cue: blue arrows show deoxygenated blood; red arrows show oxygenated blood.");
  } else if (isReactionRateTopic(heading, combined)) {
    extras.push("Graph cue: steeper curve means faster reaction rate.");
    extras.push("Plateau cue: same final height means the same final amount of product.");
  } else if (isFoodBreakdownTopic(heading, combined)) {
    extras.push("Order to remember: ingestion -> digestion -> absorption -> assimilation -> egestion.");
  } else if (containsAny(combined, ["physical digestion", "chemical digestion"])) {
    extras.push("Comparison cue: physical digestion changes size; chemical digestion changes molecules.");
  } else if (containsAny(combined, ["xylem", "phloem"])) {
    extras.push("Transport cue: xylem carries water and minerals; phloem carries food made by photosynthesis.");
  } else if (containsAny(combined, ["redox", "oxidation", "reduction"])) {
    extras.push("Memory cue: oxidation adds oxygen; reduction removes oxygen.");
  }

  const seen = new Set<string>();
  return [...extras, ...cleaned]
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 14);
}

function expandHybridNote(note: GeneratedNoteItem): GeneratedNoteItem[] {
  const combined = `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`;
  if (/digestion processes and plant transport/i.test(note.heading) && containsAny(combined, ["xylem", "phloem", "chemical digestion"])) {
    return [
      {
        heading: "Digestion processes",
        explanation:
          "Digestion works by combining mechanical breakdown with chemical breakdown. Physical digestion increases surface area by chewing and churning food, while chemical digestion uses enzymes and digestive chemicals to turn large insoluble molecules into small soluble molecules that can be absorbed.",
        bullets: [
          "Comparison cue: physical digestion changes size; chemical digestion changes molecules.",
          "Enzymes: biological catalysts such as amylase, protease, and lipase that break food molecules down faster.",
          "Hydrochloric acid: kills bacteria in the stomach and gives pepsin the acidic conditions it needs.",
          "Bile: neutralizes stomach acid and emulsifies fats so enzymes can act on a larger surface area.",
          "Physical digestion: chewing and stomach churning break food into smaller pieces without making a new substance.",
          "Chemical digestion: enzymes break large insoluble food molecules into small soluble molecules.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
      {
        heading: "Plant transport definitions",
        explanation:
          "The same source section also defines the plant transport tissues. Xylem and phloem are not interchangeable: xylem carries water and minerals from the roots upward, while phloem carries dissolved food from photosynthesising leaves to the parts of the plant that need it.",
        bullets: [
          "Transport cue: xylem carries water and minerals; phloem carries food made by photosynthesis.",
          "Xylem: transports water and mineral ions from roots toward stems and leaves.",
          "Xylem support: its structure also helps strengthen the plant.",
          "Phloem: transports dissolved food from leaves to non-photosynthesising regions.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
    ];
  }

  if (/plant anatomy and heart/i.test(note.heading) && containsAny(combined, ["xylem", "phloem", "vena cava", "right atrium"])) {
    return [
    {
      heading: "Plant transport tissues",
      explanation:
        "The plant diagrams show where xylem and phloem sit inside leaf and stem cross-sections. Xylem is the water-and-mineral transport tissue, while phloem carries food made by photosynthesis. In diagrams, study them as a paired transport system inside vascular bundles rather than as isolated labels.",
      bullets: [
        "Transport cue: xylem carries water and minerals; phloem carries food made by photosynthesis.",
        "Xylem: transports water and mineral ions from roots toward stems and leaves, and also helps support the plant.",
        "Phloem: transports dissolved food from photosynthesising leaves to parts of the plant that need or store it.",
        "Vascular bundle: a grouped transport area that contains xylem and phloem together.",
        "Leaf cross-section: use the labelled cells and vascular bundle to locate where transport happens in a leaf.",
        "Stem cross-section: use the ring or grouped arrangement to see how transport tissues run through the stem.",
      ],
      sourceChunkIds: note.sourceChunkIds,
      pageNumber: note.pageNumber,
    },
    {
      heading: "Heart anatomy and blood flow",
      explanation:
        "The heart diagram is best learned as two connected blood-flow routes. The right side receives deoxygenated blood from the body and sends it to the lungs. The left side receives oxygenated blood from the lungs and pumps it out to the body. Valves keep blood moving one way, and the colored arrows help separate oxygen-poor and oxygen-rich blood.",
      bullets: [
        "Flow to remember: vena cava -> right atrium -> right ventricle -> pulmonary artery -> lungs.",
        "Oxygenated flow: pulmonary vein -> left atrium -> left ventricle -> aorta -> body.",
        "Color cue: blue arrows show deoxygenated blood; red arrows show oxygenated blood.",
        "Vena cava: returns deoxygenated blood from the body to the right atrium.",
        "Right ventricle: pumps deoxygenated blood to the lungs through the pulmonary artery.",
        "Pulmonary vein: brings oxygenated blood from the lungs to the left atrium.",
        "Left ventricle: pumps oxygenated blood out through the aorta to the body.",
        "Heart valves: prevent backflow so blood continues in the correct direction.",
      ],
      sourceChunkIds: note.sourceChunkIds,
      pageNumber: note.pageNumber,
    },
    ];
  }

  if (/heart.*chemical change|chemical change.*heart/i.test(note.heading) && containsAny(combined, ["arteries", "capillaries", "physical change", "chemical change"])) {
    return [
      {
        heading: "Blood vessels and circulation",
        explanation:
          "Blood vessels form the transport network connected to the heart. Arteries carry blood away from the heart, veins bring blood back, and capillaries are the small exchange surfaces where materials move between blood and body tissues.",
        bullets: [
          "Arteries: carry blood away from the heart.",
          "Veins: carry blood back toward the heart.",
          "Capillaries: allow exchange of oxygen, nutrients, carbon dioxide, and waste between blood and tissues.",
          "Circulation link: the heart supplies the pressure that keeps blood moving through these vessels.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
      {
        heading: "Physical vs chemical changes",
        explanation:
          "Physical and chemical changes are separated by whether a new substance forms. In a physical change, the material changes form or state but keeps the same identity. In a chemical change, a new substance is produced and the change is usually harder to reverse.",
        bullets: [
          "Physical change: no new substance is formed.",
          "Physical changes are usually easier to reverse.",
          "Physical changes can often be separated by simple methods.",
          "Chemical change: a new substance is formed.",
          "Chemical changes are usually difficult to reverse.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
    ];
  }

  if (/temperature.*redox|redox.*temperature|catalysts.*redox/i.test(note.heading) && containsAny(combined, ["temperature", "catalyst", "oxidation", "reduction"])) {
    return [
      {
        heading: "Temperature and catalysts in reaction rates",
        explanation:
          "Temperature and catalysts both make reactions happen faster, but they do not increase the final amount of product shown by the plateau. Higher temperature gives particles more kinetic energy, while a catalyst provides an easier reaction pathway with lower activation energy.",
        bullets: [
          "Graph cue: steeper curve means faster reaction rate.",
          "Plateau cue: same final height means the same final amount of product.",
          "Higher temperature: particles move faster and collide more successfully.",
          "Catalyst: speeds up the reaction without being used up.",
          "With a catalyst: the curve reaches the plateau sooner than the reaction without a catalyst.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
      {
        heading: "Redox reactions",
        explanation:
          "A redox reaction has oxidation and reduction happening at the same time. In this oxygen-based definition, oxidation means oxygen is added to a substance, while reduction means oxygen is removed from a substance.",
        bullets: [
          "Memory cue: oxidation adds oxygen; reduction removes oxygen.",
          "Redox reaction: oxidation and reduction occur together in one reaction.",
          "Oxidation: addition of oxygen to an element or compound.",
          "Reduction: removal of oxygen from an element or compound.",
        ],
        sourceChunkIds: note.sourceChunkIds,
        pageNumber: note.pageNumber,
      },
    ];
  }

  return [note];
}

function joinHeadingTerms(terms: string[]) {
  if (terms.length <= 1) return terms[0] || "";
  if (terms.length === 2) return `${terms[0]} and ${terms[1]}`;
  return `${terms.slice(0, -1).join(", ")}, and ${terms[terms.length - 1]}`;
}

function keyTermHeading(lines: string[]) {
  const terms = lines
    .map((line) => /^([^:]{3,44}):/.exec(line)?.[1]?.trim())
    .filter((term): term is string => Boolean(term && !LABEL_ONLY_PATTERN.test(term)))
    .filter((term) => !/^(key concept|function|note|tip)$/i.test(term));
  const uniqueTerms = Array.from(new Set(terms.map(sentenceCase)));
  return uniqueTerms.length >= 2 ? joinHeadingTerms(uniqueTerms.slice(0, 3)) : "";
}

function titleFromSection(section: VisionSection, lines: string[]) {
  const pageFallback = `Study topic ${section.pageNumber || 1}`;
  const explicitHeading = lines.map(explicitHeadingValue).find(Boolean);
  if (explicitHeading) return sentenceCase(explicitHeading);
  const titleLine = lines.find((line) => /^title\s*:/i.test(line));
  if (titleLine) return sentenceCase(titleLine.replace(/^title\s*:\s*/i, ""));
  const importantLine = lines.find((line) => /^(important text|extracted text|important extracted text)\s*:/i.test(line));
  if (importantLine) {
    const value = stripBoilerplate(importantLine)
      .replace(/^["'](.+)["']$/g, "$1")
      .replace(/\s*,\s*(?:and\s*)?(?:quiz ideas|flashcard ideas|preserve important terms).*$/i, "")
      .trim();
    if (value && value.length <= 100 && !GENERIC_HEADING_PATTERN.test(value)) return sentenceCase(value);
  }
  const plainHeading = lines.find(isTopicHeading);
  if (plainHeading) return sentenceCase(plainHeading);
  const termsHeading = keyTermHeading(lines);
  if (termsHeading) return termsHeading;
  return pageFallback;
}

function summaryFromSection(lines: string[]) {
  const summaryIndex = lines.findIndex((line) => /^summary\s*:/i.test(line));
  if (summaryIndex >= 0) {
    const summary = [
      lines[summaryIndex].replace(/^summary\s*:\s*/i, ""),
      ...lines
        .slice(summaryIndex + 1, summaryIndex + 4)
        .filter((line) => !/^(quiz ideas|flashcard ideas|title)\s*:?/i.test(line)),
    ]
      .join(" ")
      .trim();
    if (summary.length >= 30) return summary;
  }
  return lines
    .filter((line) => !/^(quiz ideas|flashcard ideas|front|back|title)\s*:?/i.test(line))
    .filter((line) => !isExplicitHeading(line))
    .filter((line) => !isTopicHeading(line))
    .slice(0, 5)
    .map(normalizeSentence)
    .join(" ");
}

function buildVisionBackedNotes(fileName: string, chunks: SourceChunkForNotes[]) {
  const sections = chunks.flatMap(splitVisionSections);
  if (sections.length === 0) return null;

  const notes: GeneratedNoteItem[] = sections.flatMap((section) => {
    const lines = sectionLines(section.text);
    const groups = splitTopicGroups(lines);
    return groups.map((group) => {
      const heading = titleFromSection(section, group);
      const headingCore = comparableLine(stripPagePrefix(heading));
      const rawBullets = group
        .filter((line) => !/^title\s*:/i.test(line))
        .filter((line) => comparableLine(line) !== comparableLine(heading))
        .filter((line) => comparableLine(line) !== headingCore)
        .filter((line) => !/^summary\s*:/i.test(line))
        .filter((line) => !/^(quiz ideas|flashcard ideas)\s*:?/i.test(line))
        .map(normalizeSentence);
      const fallbackExplanation =
        summaryFromSection(group.filter((line) => line.toLowerCase() !== headingCore)) ||
        "Key ideas from this part of the source.";
      const bullets = enrichStudyBullets(heading, rawBullets);
      return {
        heading,
        explanation: buildHumanExplanation(heading, rawBullets, fallbackExplanation),
        bullets,
        sourceChunkIds: [section.chunk.id],
        pageNumber: section.pageNumber,
      };
    }).filter((note) => note.bullets.length > 0 && !/^study topic\s+\d+/i.test(note.heading));
  });

  const expandedNotes = notes.flatMap(expandHybridNote);
  const headings = expandedNotes.slice(0, 8).map((note) => stripPagePrefix(note.heading).toLowerCase());
  return {
    documentTitle: titleFromFileName(fileName),
    shortSummary: headings.length
      ? `This study guide covers ${headings.join(", ")}${expandedNotes.length > headings.length ? ", and related visual concepts" : ""}.`
      : "This study guide was created from AI vision analysis of the uploaded source.",
    notes: expandedNotes,
  };
}

export function buildSourceBackedNotes(fileName: string, chunks: SourceChunkForNotes[]) {
  const visionBacked = buildVisionBackedNotes(fileName, chunks);
  if (visionBacked && visionBacked.notes.length > 0) return visionBacked;

  const usableChunks = chunks.filter((chunk) => cleanStudyLine(chunk.cleanedText).length >= 20);
  const notes: GeneratedNoteItem[] = usableChunks.map((chunk) => {
    const heading = headingFromChunk(chunk);
    const rawBullets = bulletLines(chunk.cleanedText).filter((line) => line.toLowerCase() !== heading.toLowerCase());
    const explanationSource = rawBullets
      .filter((line) => !/^title\s*:/i.test(line))
      .slice(0, 5)
      .join(" ");
    const bullets = enrichStudyBullets(heading, rawBullets);
    return {
      heading,
      explanation: buildHumanExplanation(
        heading,
        rawBullets,
        explanationSource ||
          `This section captures the readable study material extracted from ${chunk.pageNumber ? `page ${chunk.pageNumber}` : "the document"}.`,
      ),
      bullets: bullets.slice(0, 14),
      sourceChunkIds: [chunk.id],
      pageNumber: chunk.pageNumber || undefined,
    };
  });
  const headings = notes.slice(0, 6).map((note) => stripPagePrefix(note.heading).toLowerCase());
  const shortSummary = headings.length
    ? `This study guide covers ${headings.join(", ")}${notes.length > headings.length ? ", and related concepts" : ""}.`
    : "This study guide was created from the readable text extracted from the uploaded source.";
  return {
    documentTitle: titleFromFileName(fileName),
    shortSummary,
    notes,
  };
}
