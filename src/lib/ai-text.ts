function cleanEncoding(value: string) {
  return value
    .replace(/â|â|â/g, "-")
    .replace(/â/g, "'")
    .replace(/â|â/g, "\"")
    .replace(/Â²/g, "2")
    .replace(/Â³/g, "3")
    .replace(/âº/g, "+")
    .replace(/â/g, "->")
    .replace(/[–—‑]/g, "-")
    .replace(/[’]/g, "'")
    .replace(/[“”]/g, "\"")
    .trim();
}

export function cleanAiTextResponse(value: string) {
  const trimmed = cleanEncoding(value.replace(/^```(?:json|text|markdown)?\s*/i, "").replace(/```$/i, ""));

  if (!trimmed) return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const text = record.text || record.message || record.answer || record.content || record.response || record.explanation;
      const check = record.check_for_understanding || record.checkForUnderstanding || record.question;
      if (typeof text === "string" && text.trim()) {
        return cleanEncoding(
          typeof check === "string" && check.trim()
            ? `${text.trim()}\n\nCheck for understanding: ${check.trim()}`
            : text.trim(),
        );
      }
    }
  } catch {
    // Plain text is the normal path.
  }

  return cleanEncoding(trimmed);
}
