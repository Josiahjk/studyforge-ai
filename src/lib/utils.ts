import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toJsonArray(values: string[] | string | undefined) {
  if (!values) return "[]";
  if (typeof values === "string") {
    return JSON.stringify(
      values
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    );
  }
  return JSON.stringify(values.map((tag) => tag.trim()).filter(Boolean));
}

export function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(date));
}

export function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
