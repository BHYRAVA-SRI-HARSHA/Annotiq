import { Modal } from "@/shared/ui/Modal";
import { useAnnotationStore } from "../state/annotationStore";

// Mirrors the reference tool's "Delete N element(s)?" popup exactly:
// three tiered delete actions (keep children / cascade but keep links /
// cascade everything) plus Cancel. Only shown when the selection actually
// has children — a leaf shape deletes immediately with no popup.
export function DeleteConfirmDialog() {
  const pendingDelete = useAnnotationStore((s) => s.pendingDeleteRequest);
  const resolveDelete = useAnnotationStore((s) => s.resolveDeleteRequest);

  const open = pendingDelete !== null;
  const count = pendingDelete?.rootIds.length ?? 0;
  const childCount = pendingDelete?.childCount ?? 0;
  const total = count + childCount;

  return (
    <Modal open={open} onClose={() => resolveDelete("cancel")} width={460}>
      <h3 style={{ margin: "0 0 12px", fontSize: 17 }}>
        Delete {count} element{count === 1 ? "" : "s"}?
      </h3>

      {childCount > 0 ? (
        <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
          The selection includes parent elements with <strong>{childCount}</strong> child element
          {childCount === 1 ? "" : "s"}. Choose how to handle the children.
        </p>
      ) : (
        <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--color-text-muted)" }}>
          This action can’t be undone.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {childCount > 0 && (
          <>
            <DialogOption
              tone="warn"
              label="Delete only this"
              hint="(keep children)"
              onClick={() => resolveDelete("only")}
            />
            <DialogOption
              tone="warn"
              label="Delete element + children"
              hint="(keep lines & links)"
              onClick={() => resolveDelete("children")}
            />
            <DialogOption
              tone="danger"
              label="Delete with children"
              hint={`(${total} total, incl. associations)`}
              onClick={() => resolveDelete("all")}
            />
          </>
        )}
        {childCount === 0 && (
          <DialogOption tone="danger" label="Delete" hint="" onClick={() => resolveDelete("only")} />
        )}

        <button
          onClick={() => resolveDelete("cancel")}
          style={{
            padding: "11px 14px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 6,
            border: "1px solid var(--color-accent)",
            color: "var(--color-accent)",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

function DialogOption({
  tone,
  label,
  hint,
  onClick,
}: {
  tone: "warn" | "danger";
  label: string;
  hint: string;
  onClick: () => void;
}) {
  // Fixed (not theme-var) colors on purpose — these are semantic
  // warning/danger tones that need to stay legible against both the light
  // and dark --color-bg, not blend into whichever theme is active.
  const toneStyle =
    tone === "danger"
      ? { background: "#dc2626", color: "#fff", border: "1px solid #dc2626" }
      : { background: "#fdf1d7", color: "#3f2d05", border: "1px solid #f4dda0" };

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        padding: "11px 14px",
        fontSize: 14,
        borderRadius: 6,
        cursor: "pointer",
        ...toneStyle,
      }}
    >
      <strong>{label}</strong>
      {hint && <span style={{ fontWeight: 400, marginLeft: 6 }}>{hint}</span>}
    </button>
  );
}
