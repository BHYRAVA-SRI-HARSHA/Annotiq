import { AnnotationProperties } from "@/shared/api/types";

export interface WordColorRule {
  key: string;
  label: string;
  color: string;
  test: (props: AnnotationProperties) => boolean;
}

// Order is priority order, highest first — mirrors the reference tool's
// "WORD COLORS" legend and its footnote: "A word takes the topmost color
// whose attribute it has." skip_transcription always wins (a skipped word
// should always read as skipped, e.g. even if it's also marked vertical).
export const WORD_COLOR_RULES: WordColorRule[] = [
  {
    key: "skip_transcription",
    label: "skip_transcription",
    color: "#f2994a",
    test: (p) => Boolean(p.skipTranscription),
  },
  { key: "IsVertical", label: "IsVertical", color: "#c9d92e", test: (p) => Boolean(p.isVertical) },
  { key: "IsSignature", label: "IsSignature", color: "#4caf50", test: (p) => Boolean(p.isSignature) },
  { key: "IsWatermark", label: "IsWatermark", color: "#2ecc71", test: (p) => Boolean(p.isWatermark) },
  {
    key: "WritingType:Handwritten",
    label: "WritingType: Handwritten",
    // Pale cyan-blue, not the previous much more saturated #26c6da — that
    // rendered as a fairly bold teal once blended with the shape fill
    // alpha, but the reference tool's own selected-word screenshot shows
    // a clearly pale, washed-out blue. This hex is picked so it blends to
    // match that reference tone (~#c5f5f7) at the "selected" fill alpha.
    color: "#8fe9f0",
    test: (p) => p.writingType === "Handwritten",
  },
  {
    key: "WritingType:Printed",
    label: "WritingType: Printed",
    color: "#3b82f6",
    test: (p) => p.writingType === "Printed",
  },
  { key: "isMath", label: "isMath", color: "#8b5cf6", test: (p) => Boolean(p.isMath) },
  { key: "isLatex", label: "isLatex", color: "#d946ef", test: (p) => Boolean(p.isLatex) },
  { key: "isBoxForm", label: "isBoxForm", color: "#e5384f", test: (p) => Boolean(p.isBoxForm) },
];

export function defaultWordColorVisibility(): Record<string, boolean> {
  return Object.fromEntries(WORD_COLOR_RULES.map((r) => [r.key, true]));
}

// Picks the highest-priority visible rule a Word satisfies, or null to fall
// back to the shape's ordinary label color.
export function wordColorFor(
  props: AnnotationProperties,
  visibility: Record<string, boolean>
): string | null {
  for (const rule of WORD_COLOR_RULES) {
    if (visibility[rule.key] === false) continue;
    if (rule.test(props)) return rule.color;
  }
  return null;
}

// Turning a WORD COLORS toggle off is a visibility filter, not just a
// recolor — a word whose *only* qualifying attribute is now hidden should
// disappear from the document like the LABELS panel's own eye icons do,
// not fall back to showing as a plain Word box with its edges still
// visible. A word with more than one attribute stays visible as long as
// at least one of them is still switched on (it just displays using
// whichever visible attribute is highest priority, per wordColorFor
// above); only a word with zero visible qualifying attributes — despite
// having at least one attribute at all — gets hidden here. An ordinary
// word with none of these attributes is never affected by these toggles.
export function isWordHiddenByColorToggle(
  props: AnnotationProperties,
  visibility: Record<string, boolean>
): boolean {
  let matchedAnyRule = false;
  for (const rule of WORD_COLOR_RULES) {
    if (!rule.test(props)) continue;
    matchedAnyRule = true;
    if (visibility[rule.key] !== false) return false; // at least one qualifying attribute is visible
  }
  return matchedAnyRule;
}
