import "server-only";
import type { GeneratedNoteItem } from "@/lib/generated-note-data";

export type NoteVisualInput = {
  id: string;
  imageIndex: number;
  pageNumber?: number | null;
  contentType: string;
  dataUrl: string;
  altText?: string | null;
};

export type NoteVisual = NoteVisualInput & {
  displayDataUrl: string;
  displayContentType: string;
};

function noteText(note: GeneratedNoteItem) {
  return `${note.heading}\n${note.explanation}\n${note.bullets.join("\n")}`;
}

export function shouldShowVisualForNote(note: GeneratedNoteItem, sourceText: string) {
  const ownNoteText = noteText(note);
  const combined = ownNoteText.toLowerCase();
  const saysNoVisuals = /\b(no diagrams?|there are no diagrams?|no charts?|no formulas?|text-only)\b/i.test(sourceText);
  const visualTerms =
    /\b(diagram|graph|chart|table|pathway|axis|curve|formula|screenshot|whiteboard|labelled|labeled|cross[- ]section|bond breaking|bond forming|blood flow|heart valve|valve|atrium|ventricle|aorta|vena cava|pulmonary|xylem|phloem|leaf|stem|vascular bundle|reaction pathway)\b/i;

  if (saysNoVisuals && !/\b(diagram|graph|chart|table|pathway|cross[- ]section|blood flow|heart valve|valve|atrium|ventricle|aorta|xylem|phloem)\b/i.test(ownNoteText)) {
    return false;
  }

  return visualTerms.test(combined);
}

export function toNoteVisual(image: NoteVisualInput): NoteVisual {
  return { ...image, displayDataUrl: image.dataUrl, displayContentType: image.contentType };
}
