export const STUDY_LANGUAGE_CODES = ["en", "ms", "id", "zh"] as const;

export type StudyLanguage = (typeof STUDY_LANGUAGE_CODES)[number];

export const studyLanguageLabels: Record<StudyLanguage, string> = {
  en: "English",
  ms: "Melayu",
  id: "Indonesia",
  zh: "Chinese",
};

export function normalizeStudyLanguage(value: string | null | undefined): StudyLanguage {
  return STUDY_LANGUAGE_CODES.includes(value as StudyLanguage) ? (value as StudyLanguage) : "en";
}

export function studyLanguageInstruction(value: string | null | undefined) {
  const language = normalizeStudyLanguage(value);
  const label = studyLanguageLabels[language];
  const detail: Record<StudyLanguage, string> = {
    en: "English",
    ms: "Bahasa Melayu",
    id: "Bahasa Indonesia",
    zh: "Simplified Chinese",
  };

  return {
    code: language,
    label,
    prompt: `Write all learner-facing content in ${detail[language]}. Keep JSON property names exactly as requested.`,
  };
}
