import type { Card } from "@prisma/client";

export type ReviewRating = "again" | "hard" | "good" | "easy";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

export function scheduleReview(card: Card, rating: ReviewRating) {
  const previousEase = card.easeFactor;
  const previousInterval = card.interval;
  let easeFactor = card.easeFactor;
  let interval = card.interval;
  let repetitions = card.repetitions;
  let lapses = card.lapses;
  let dueAt = new Date(Date.now() + 10 * 60 * 1000);
  let correct = true;

  if (rating === "again") {
    easeFactor = Math.max(1.3, easeFactor - 0.2);
    interval = 0;
    repetitions = 0;
    lapses += 1;
    correct = false;
  }

  if (rating === "hard") {
    easeFactor = Math.max(1.3, easeFactor - 0.15);
    repetitions += 1;
    interval = Math.max(1, Math.ceil(Math.max(1, interval) * 1.2));
    dueAt = addDays(interval);
  }

  if (rating === "good") {
    repetitions += 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 3;
    else interval = Math.max(4, Math.ceil(Math.max(1, interval) * easeFactor));
    dueAt = addDays(interval);
  }

  if (rating === "easy") {
    easeFactor = easeFactor + 0.15;
    repetitions += 1;
    interval = repetitions <= 1 ? 4 : Math.ceil(Math.max(1, interval) * (easeFactor + 0.3));
    dueAt = addDays(interval);
  }

  return {
    correct,
    dueAt,
    easeFactor: Math.max(1.3, Number(easeFactor.toFixed(2))),
    interval,
    repetitions,
    lapses,
    previousEase,
    previousInterval,
  };
}
