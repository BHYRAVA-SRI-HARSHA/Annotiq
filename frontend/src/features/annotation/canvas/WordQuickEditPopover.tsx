import { useEffect, useRef } from "react";
import { useAnnotationStore } from "../state/annotationStore";
import { Annotation, SkipReason, WritingType } from "@/shared/api/types";
import { CloseIcon, TrashIcon } from "@/shared/ui/icons";
import { getWordCloseError } from "../state/types";

const SKIP_REASONS: SkipReason[] = ["Blurry", "UnknownScript", "InvertedText", "Unreadable", "Redacted"];

// Unicode super/subscript character maps for the "highlight text, click
// Superscript/Subscript" transform. A plain <input> can't render mixed
// font sizes/baselines, so this is the only way to actually show raised
// or lowered characters inline with the rest of the transcription — same
// trick as the reference tool. Coverage is whatever Unicode actually
// defines pre-composed glyphs for (full digits/math symbols, but only a
// partial Latin alphabet — there's no Unicode superscript "q" or
// subscript "b", for instance); any character with no mapping is left
// exactly as typed rather than silently dropped.
const SUPERSCRIPT_MAP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};
const SUBSCRIPT_MAP: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ",
  t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

function toScript(text: string, map: Record<string, string>): string {
  return Array.from(text)
    .map((ch) => map[ch] ?? map[ch.toLowerCase()] ?? ch)
    .join("");
}

interface WordQuickEditPopoverProps {
  annotation: Annotation;
  // Shape's bounding rect in container-local pixel space (Konva's
  // getClientRect() already accounts for stage pan/zoom).
  anchorRect: { x: number; y: number; width: number; height: number };
  containerSize: { width: number; height: number };
  // Whether the Transcription input should grab keyboard focus on mount.
  // Defaults to true for a direct canvas click (fast editing); the canvas
  // passes false when this popover was opened by keyboard navigation, so
  // arrow keys keep moving between shapes instead of getting captured as
  // text-caret movement inside this input.
  autoFocusInput?: boolean;
  onClose: () => void;
}

const POPOVER_WIDTH = 264;

// Mirrors the reference tool's inline "click a Word -> edit its
// transcription right there on the canvas" popup, instead of forcing a trip
// to the right-hand panel for every single word.
export function WordQuickEditPopover({
  annotation,
  anchorRect,
  containerSize,
  autoFocusInput = true,
  onClose,
}: WordQuickEditPopoverProps) {
  const updateProperties = useAnnotationStore((s) => s.updateProperties);
  const requestDeleteSelected = useAnnotationStore((s) => s.requestDeleteSelected);
  const ontology = useAnnotationStore((s) => s.ontology);
  const blockedWordClose = useAnnotationStore((s) => s.blockedWordClose);
  const props = annotation.properties;
  const color = ontology?.labels.find((l) => l.name === annotation.labelName)?.color ?? "#4f46e5";
  const skipReasonMissing = Boolean(props.skipTranscription) && !props.skipReason;
  // Mirrors skipReasonMissing above, for the other half of the same rule
  // (Sec. 7.1/7.8): once Skip Transcription is off, a real transcription
  // is required, so an empty/whitespace-only field is flagged exactly the
  // same way — both are really just the two branches of getWordCloseError.
  const transcriptionMissing = !props.skipTranscription && !props.transcription?.trim();
  const closeBlocked = blockedWordClose?.annotationId === annotation.id ? blockedWordClose.message : null;

  const transcriptionInputRef = useRef<HTMLInputElement>(null);
  const skipReasonSelectRef = useRef<HTMLSelectElement>(null);

  // A blocked close attempt (X button, clicking another shape, Escape,
  // clicking empty canvas — see the `select` gate in annotationStore.ts)
  // should land the user's cursor right in whichever field needs fixing,
  // not just show a banner and leave them to go hunting for it.
  useEffect(() => {
    if (!closeBlocked) return;
    if (props.skipTranscription) skipReasonSelectRef.current?.focus();
    else transcriptionInputRef.current?.focus();
  }, [closeBlocked, props.skipTranscription]);

  const spaceRight = containerSize.width - (anchorRect.x + anchorRect.width);
  const placeLeft = spaceRight < POPOVER_WIDTH + 24 && anchorRect.x > POPOVER_WIDTH + 24;
  const left = placeLeft ? anchorRect.x - POPOVER_WIDTH - 12 : anchorRect.x + anchorRect.width + 12;
  const top = Math.min(Math.max(anchorRect.y, 8), Math.max(containerSize.height - 420, 8));

  // Transforms exactly the highlighted portion of the transcription — per
  // spec this only acts on a selection, so with nothing highlighted it's a
  // no-op rather than guessing (e.g. appending at the cursor, which is what
  // the old version of this button did and wasn't actually what got asked
  // for). Re-selects the transformed range afterward so a second click can
  // still target the same span (e.g. to switch super->sub).
  function applyScript(map: Record<string, string>) {
    const input = transcriptionInputRef.current;
    const current = props.transcription ?? "";
    if (!input || input.selectionStart == null || input.selectionEnd == null) return;
    const [start, end] = [input.selectionStart, input.selectionEnd];
    if (start === end) return; // nothing highlighted — do nothing

    const before = current.slice(0, start);
    const selected = current.slice(start, end);
    const after = current.slice(end);
    const transformed = toScript(selected, map);
    updateProperties(annotation.id, { transcription: `${before}${transformed}${after}` });

    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start, start + transformed.length);
    });
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left,
        top,
        width: POPOVER_WIDTH,
        maxHeight: 440,
        overflowY: "auto",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        boxShadow: "0 10px 32px rgba(0,0,0,0.28)",
        zIndex: 50,
        fontSize: 13,
        // Otherwise inherits whatever cursor the canvas container behind
        // it currently has set ("grab", "move", etc.) — this is a normal
        // HTML form, its own controls should show their normal cursors.
        cursor: "default",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 12px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} />
        <strong style={{ flex: 1, letterSpacing: 0.3 }}>{annotation.labelName.toUpperCase()}</strong>
        {/* Explicit delete affordance — reliable regardless of where DOM
            focus currently sits (e.g. right after toggling a checkbox
            below), unlike the keyboard Delete/Backspace shortcut. */}
        <button
          onClick={() => {
            requestDeleteSelected();
            onClose();
          }}
          title="Delete this word"
          style={{ ...closeBtnStyle, color: "#c94f4f" }}
        >
          <TrashIcon size={13} />
        </button>
        <button onClick={onClose} title="Close" style={closeBtnStyle}>
          <CloseIcon />
        </button>
      </div>

      <div style={{ padding: "10px 12px 14px" }}>
        {closeBlocked && (
          <div
            role="alert"
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 6,
              background: "#fef2f2",
              border: "1px solid #fca5a5",
              color: "#b91c1c",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 12.5,
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            {closeBlocked === "transcription needed" ? "Transcription needed." : "Skip reason is missing."}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", wordBreak: "break-all", marginBottom: 10 }}>
          ID {annotation.id}
        </div>

        <label style={fieldLabelStyle}>
          Language <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <select
          value={props.language ?? "English"}
          onChange={(e) => updateProperties(annotation.id, { language: e.target.value })}
          style={fieldInputStyle}
        >
          <option>English</option>
          <option>Spanish</option>
          <option>French</option>
          <option>German</option>
          <option>Other</option>
        </select>

        <label style={fieldLabelStyle}>
          Transcription <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            ref={transcriptionInputRef}
            autoFocus={autoFocusInput}
            value={props.transcription ?? ""}
            onChange={(e) => updateProperties(annotation.id, { transcription: e.target.value })}
            disabled={Boolean(props.skipTranscription)}
            placeholder="Type the transcription…"
            style={{
              ...fieldInputStyle,
              margin: 0,
              flex: 1,
              borderColor: transcriptionMissing && closeBlocked ? "#ef4444" : fieldInputStyle.borderColor,
            }}
          />
          <button
            title="Highlight text first, then click to superscript it"
            // preventDefault stops the button click from blurring the
            // input first — without it, the selection is gone by the
            // time applyScript reads selectionStart/selectionEnd.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyScript(SUPERSCRIPT_MAP)}
            style={markBtnStyle}
          >
            x²
          </button>
          <button
            title="Highlight text first, then click to subscript it"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyScript(SUBSCRIPT_MAP)}
            style={markBtnStyle}
          >
            x₂
          </button>
        </div>
        {transcriptionMissing && closeBlocked && (
          <p style={{ color: "#ef4444", fontSize: 11.5, margin: "4px 0 0" }}>Transcription needed.</p>
        )}

        <CheckRow
          label="Skip Transcription"
          checked={Boolean(props.skipTranscription)}
          onChange={(v) => updateProperties(annotation.id, { skipTranscription: v })}
        />

        {props.skipTranscription && (
          <>
            <label style={fieldLabelStyle}>
              Skip reason <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <select
              ref={skipReasonSelectRef}
              value={props.skipReason ?? ""}
              onChange={(e) => updateProperties(annotation.id, { skipReason: e.target.value as SkipReason })}
              style={skipReasonMissing ? { ...fieldInputStyle, borderColor: "#ef4444" } : fieldInputStyle}
            >
              <option value="">Select a reason…</option>
              {SKIP_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {skipReasonMissing && (
              <p style={{ color: "#ef4444", fontSize: 11.5, margin: "4px 0 0" }}>
                Skip reason is required.
              </p>
            )}
          </>
        )}

        <label style={fieldLabelStyle}>Writing type</label>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 4 }}>
          {(["Printed", "Handwritten"] as WritingType[]).map((wt) => (
            <label key={wt} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <input
                type="radio"
                // Namespaced (and unique per annotation) so this radio group
                // never collides with the Properties panel's own
                // "writingType" group for the same Word — same `name` on
                // simultaneously-mounted radios in different components is
                // exactly what made Printed/Handwritten look out of sync
                // between the two panels (native radio grouping is
                // document-wide, not scoped to a component).
                name={`writingType-popover-${annotation.id}`}
                checked={props.writingType === wt}
                onChange={() => updateProperties(annotation.id, { writingType: wt })}
              />
              {wt}
            </label>
          ))}
        </div>

        <CheckRow
          label="IsVertical"
          checked={Boolean(props.isVertical)}
          onChange={(v) => updateProperties(annotation.id, { isVertical: v })}
        />
        <CheckRow
          label="IsSignature"
          checked={Boolean(props.isSignature)}
          onChange={(v) => updateProperties(annotation.id, { isSignature: v })}
        />
        <CheckRow
          label="IsWatermark"
          checked={Boolean(props.isWatermark)}
          onChange={(v) => updateProperties(annotation.id, { isWatermark: v })}
        />

        <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "10px 0 0" }}>
          More fields (rotation, math/LaTeX, box-form) are in the Properties panel →
        </p>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "10px 0 0", fontSize: 13 }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Enabled
      </span>
    </label>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11.5,
  fontWeight: 600,
  margin: "12px 0 4px",
  color: "var(--color-text-muted)",
};

const fieldInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 8px",
  fontSize: 13,
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "var(--color-surface)",
  color: "var(--color-text)",
};

const markBtnStyle: React.CSSProperties = {
  width: 30,
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  background: "var(--color-surface)",
  cursor: "pointer",
  fontSize: 12,
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
};
