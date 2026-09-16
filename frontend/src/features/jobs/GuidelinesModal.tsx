import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";

interface GuidelinesModalProps {
  open: boolean;
  onClose: () => void;
}

interface GuidelineSection {
  title: string;
  accent: string;
  points: string[];
}

// Curated from the team's full OCR annotation rules reference (121 rules
// across general, word, line, KV, clickable, and value-bbox behavior).
// This is deliberately NOT the whole rulebook — it's the handful of points
// per section that a brand-new annotator needs to stop making the most
// common mistakes on day one. Anything edge-case-y is left for their
// reviewer/lead to walk them through.
const SECTIONS: GuidelineSection[] = [
  {
    title: "General",
    accent: "#2563eb",
    points: [
      "Box annotation is the default. Use polygon only for curved text, non-standard shapes, or text at the very edge of the document — always drawn clockwise starting from the top left.",
      "Overlapping text and text that's up to 50% blurry can still be annotated. Watermarks can be annotated too; faint traces cannot.",
      "Every line and KV bounding box should stay aligned to the underlying word boxes.",
    ],
  },
  {
    title: "Word annotation",
    accent: "#4f46e5",
    points: [
      "Merge a word with a trailing symbol only when there's exactly one space between them (e.g. \"Hi ;\", \"Hello :\"). More than one space means separate boxes.",
      "Only filled checkboxes get annotated — bound just the mark (✓ / X / value), never the empty box around it.",
      "Printed currency + amount are bound together when ≤1 space apart; handwritten currency + amount are always a single box, regardless of spacing.",
      "A symbol repeated more than 8 times (dot leaders, dividers) should never be annotated.",
      "Superscripts and subscripts stay in one box together with their word.",
    ],
  },
  {
    title: "Line annotation",
    accent: "#0d9488",
    points: [
      "Words within 4 spaces of each other share a single line box; beyond that, split into separate lines.",
      "A ≥50% font-size jump normally splits a line — except a line mixing printed and handwritten text, which always stays together.",
      "Every table cell gets its own line box, with no exceptions for spacing or font-size rules.",
      "When printed and handwritten rules conflict on the same line, printed rules win.",
    ],
  },
  {
    title: "Word properties & transcription",
    accent: "#b45309",
    points: [
      "Tag every word as handwritten or printed, plus signature / box-form / vertical where it applies.",
      "Transcribe exactly what's highlighted, punctuation included — don't clean it up.",
      "Skip blurry words with \"blurry\" and unreadable ones with \"unknown script\" instead of guessing.",
      "Clickable field transcriptions are always ALL CAPS.",
    ],
  },
  {
    title: "Key-value (KV)",
    accent: "#a21caf",
    points: [
      "A KV pair only counts on a strict 1:1 key-to-value match. Annotate hierarchy from smaller elements up to the bigger container.",
      "An empty value still gets bound, covering the max available space — but only in templates, never in samples.",
      "Visual tables get KV annotation; logical tables don't.",
    ],
  },
  {
    title: "Clickables",
    accent: "#dc2626",
    points: [
      "Clickable true: bound the mark first, then expand the box to cover the checkbox.",
      "Clickable false: bound the checkbox only — no mark to include.",
      "If a page has no \"false\" option to pair with a \"true\" one, draw the false box yourself so the pair still exists.",
    ],
  },
];

export function GuidelinesModal({ open, onClose }: GuidelinesModalProps) {
  return (
    <Modal open={open} onClose={onClose} width={860}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Annotation guidelines</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--color-text-muted)" }}>
            The essentials to know before you start your first task — grouped the same way as the full rules
            reference.
          </p>
        </div>
        <Button onClick={onClose} aria-label="Close guidelines">
          Close
        </Button>
      </div>

      <div
        style={{
          marginTop: 18,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        {SECTIONS.map((section) => (
          <div
            key={section.title}
            style={{
              border: "1px solid var(--color-border)",
              borderLeft: `3px solid ${section.accent}`,
              borderRadius: 8,
              padding: "14px 16px",
              background: "var(--color-surface)",
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: 14, color: section.accent }}>{section.title}</h3>
            <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
              {section.points.map((point, i) => (
                <li key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text)" }}>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 18, marginBottom: 0, fontSize: 12, color: "var(--color-text-muted)" }}>
        This is a quick-start summary, not the full rulebook — ask your reviewer or lead about anything that
        doesn't fit neatly into these points.
      </p>
    </Modal>
  );
}
