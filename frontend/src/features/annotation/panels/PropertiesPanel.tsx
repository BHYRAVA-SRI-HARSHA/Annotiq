import { useAnnotationStore } from "../state/annotationStore";
import { SkipReason, WritingType } from "@/shared/api/types";

const SKIP_REASONS: SkipReason[] = ["Blurry", "UnknownScript", "InvertedText", "Unreadable", "Redacted"];

// Mirrors the reference tool's per-shape popup (Sec. 2.5 / 2.9) plus the
// full Word property set from ANNOTATION_RULES.md Sec. 6-7 — WritingType,
// skip reasons, isBoxForm/isMath/isLatex, strike-through, rotation.
export function PropertiesPanel() {
  const annotations = useAnnotationStore((s) => s.annotations);
  const selectedIds = useAnnotationStore((s) => s.selectedIds);
  const selectedAnnotationId = useAnnotationStore((s) => s.selectedAnnotationId);
  const updateProperties = useAnnotationStore((s) => s.updateProperties);

  const selected = annotations.find((a) => a.id === selectedAnnotationId);

  if (!selected) {
    return (
      <div style={{ borderTop: "1px solid var(--color-border)" }}>
        <div className="panel-header">
          <span className="panel-header__dot" style={{ background: "var(--color-amber)" }} />
          <span className="panel-header__title">Properties</span>
        </div>
        <div style={{ padding: "14px", fontSize: 13, color: "var(--color-text-muted)" }}>
          Select an element to view its properties.
        </div>
      </div>
    );
  }

  const props = selected.properties;
  const isWord = selected.labelName === "Word";
  const skipReasonMissing = Boolean(props.skipTranscription) && !props.skipReason;

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", maxHeight: "42vh", overflowY: "auto" }}>
      <div className="panel-header">
        <span className="panel-header__dot" style={{ background: "var(--color-amber)" }} />
        <span className="panel-header__title">
          Properties · {selected.labelName}{" "}
          <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>{selected.id.slice(0, 8)}</span>
          {selectedIds.length > 1 && (
            <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}> (+{selectedIds.length - 1} more selected)</span>
          )}
        </span>
      </div>

      <div style={{ padding: "10px 14px" }}>
      {!isWord && (
        <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
          Transcription/word-level flags apply to <strong>Word</strong> elements (Sec. 3: "the only element with
          Transcription/Language/flags"). Containers just wrap children.
        </p>
      )}

      {isWord && (
        <>
          <label style={labelStyle}>Language</label>
          <select
            value={props.language ?? "English"}
            onChange={(e) => updateProperties(selected.id, { language: e.target.value })}
            style={inputStyle}
          >
            <option>English</option>
            <option>Spanish</option>
            <option>French</option>
            <option>German</option>
            <option>Other</option>
          </select>

          <label style={labelStyle}>Transcription</label>
          <input
            value={props.transcription ?? ""}
            onChange={(e) => updateProperties(selected.id, { transcription: e.target.value })}
            disabled={Boolean(props.skipTranscription)}
            style={inputStyle}
          />

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "10px 0" }}>
            <input
              type="checkbox"
              checked={Boolean(props.skipTranscription)}
              onChange={(e) => updateProperties(selected.id, { skipTranscription: e.target.checked })}
            />
            Skip Transcription
          </label>

          {props.skipTranscription && (
            <>
              <label style={labelStyle}>
                Skip reason (Sec. 7.1/7.8) <span style={{ color: "var(--color-danger)" }}>*</span>
              </label>
              <select
                value={props.skipReason ?? ""}
                onChange={(e) => updateProperties(selected.id, { skipReason: e.target.value as SkipReason })}
                style={skipReasonMissing ? { ...inputStyle, borderColor: "var(--color-danger)" } : inputStyle}
              >
                <option value="">Select a reason…</option>
                {SKIP_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {skipReasonMissing && (
                <p style={{ color: "var(--color-danger)", fontSize: 11.5, margin: "4px 0 0" }}>
                  Skip reason is required.
                </p>
              )}
            </>
          )}

          <label style={labelStyle}>Writing type (Sec. 6)</label>
          <div style={{ display: "flex", gap: 12, fontSize: 13, marginBottom: 4 }}>
            {(["Printed", "Handwritten"] as WritingType[]).map((wt) => (
              <label key={wt} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <input
                  type="radio"
                  // Namespaced per-annotation so this group never collides
                  // with the quick-edit popover's own "writingType" radios
                  // when both are open for the same Word — see the matching
                  // comment in WordQuickEditPopover.
                  name={`writingType-panel-${selected.id}`}
                  checked={props.writingType === wt}
                  onChange={() => updateProperties(selected.id, { writingType: wt })}
                />
                {wt}
              </label>
            ))}
          </div>

          {(
            [
              ["isVertical", "IsVertical"],
              ["isSignature", "IsSignature"],
              ["isWatermark", "IsWatermark"],
              ["isBoxForm", "isBoxForm"],
              ["isMath", "isMath"],
              ["isLatex", "isLatex"],
              ["strikeThrough", "StrikeThrough (Sec. 7.8)"],
            ] as const
          ).map(([key, display]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, margin: "6px 0" }}>
              <input
                type="checkbox"
                checked={Boolean(props[key])}
                onChange={(e) => updateProperties(selected.id, { [key]: e.target.checked })}
              />
              {display}
            </label>
          ))}

          <label style={labelStyle}>Rotation angle (Sec. 4.6)</label>
          <input
            type="number"
            value={props.rotationAngle ?? 0}
            onChange={(e) => updateProperties(selected.id, { rotationAngle: Number(e.target.value) })}
            style={inputStyle}
          />
        </>
      )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  margin: "10px 0 4px",
  color: "var(--color-text-muted)",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  fontSize: 13,
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
};
