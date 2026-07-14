import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(100),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const deckSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(600).optional().default(""),
  subject: z.string().min(1).max(80).optional().default("General"),
  tags: z.array(z.string().min(1).max(40)).max(12).optional().default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#1f9d8a"),
  isPublic: z.boolean().optional().default(false),
});

export const cardSchema = z.object({
  type: z.enum(["qa", "mcq", "cloze"]).default("qa"),
  question: z.string().min(1).max(1200),
  answer: z.string().min(1).max(2000),
  clozeText: z.string().max(2000).optional().nullable(),
  options: z.array(z.string().min(1).max(400)).min(2).max(6).optional(),
  correctOption: z.number().int().min(0).max(5).optional().nullable(),
  explanation: z.string().max(1600).optional().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  tags: z.array(z.string().min(1).max(40)).max(12).optional().default([]),
});

export const aiModeSchema = z.enum(["auto-free", "best-free", "manual-free"]);
export const studyLanguageSchema = z.enum(["en", "ms", "id", "zh"]);

export const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "mist", "contrast"]).optional(),
  accentColor: z.union([z.literal("rainbow"), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  studyLanguage: studyLanguageSchema.optional(),
  dailyGoal: z.number().int().min(1).max(200).optional(),
});

export const notesSchema = z.object({
  notes: z.string().min(80).max(30000),
  count: z.number().int().min(1).max(50).optional().default(10),
  subject: z.string().max(80).optional().default("General"),
  modelMode: aiModeSchema.optional(),
  manualModel: z.string().max(180).optional().nullable(),
});

export const MAX_QUIZ_QUESTIONS = 150;

export const quizGenerateSchema = z.object({
  deckId: z.string().optional().nullable(),
  notes: z.string().max(80000).optional(),
  count: z.number().int().min(1).max(MAX_QUIZ_QUESTIONS).optional().default(8),
  avoidQuestions: z.array(z.string().min(1).max(280)).max(MAX_QUIZ_QUESTIONS).optional().default([]),
  fastFacts: z.boolean().optional().default(false),
  modelMode: aiModeSchema.optional(),
  manualModel: z.string().max(180).optional().nullable(),
}).refine((data) => data.deckId || (data.notes && data.notes.length >= 80), {
  message: "Choose a deck or provide at least 80 characters of notes.",
});

export const tutorSchema = z.object({
  threadId: z.string().optional().nullable(),
  subject: z.string().min(1).max(80).default("General"),
  message: z.string().min(2).max(4000),
  mode: z.enum(["default", "eli5", "example", "quiz", "step"]).default("default"),
  modelMode: aiModeSchema.optional(),
  manualModel: z.string().max(180).optional().nullable(),
});

export const reviewSchema = z.object({
  cardId: z.string(),
  rating: z.enum(["again", "hard", "good", "easy"]),
});
