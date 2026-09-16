import { useState } from "react";
import { Modal } from "@/shared/ui/Modal";
import { Button } from "@/shared/ui/Button";

interface StopAndResumeDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (dontShowAgain: boolean) => void;
}

// Mirrors the reference tool's "Stop and resume later" popup: two task-type
// scenarios (this app always behaves like the first — your draft is saved
// and restored on resume) plus a "don't show again" opt-out.
export function StopAndResumeDialog({ open, onCancel, onConfirm }: StopAndResumeDialogProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <Modal open={open} onClose={onCancel} width={560}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>Stop and resume later</h3>
        <button onClick={onCancel} title="Close" style={closeBtnStyle}>
          ✕
        </button>
      </div>

      <p style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 6px" }}>
        NER, 3D point cloud, video object detection and video object tracking tasks
      </p>
      <p style={{ fontSize: 13.5, color: "var(--color-text-muted)", lineHeight: 1.55, margin: "0 0 18px" }}>
        If you're labeling words within a larger text, or annotating one or more 3D point
        clouds or video frames, choose <strong>Save</strong> before choosing{" "}
        <strong>Confirm</strong> to keep your work and continue the task later. Saved work is
        restored automatically when you resume.
      </p>

      <p style={{ fontSize: 13.5, fontWeight: 700, margin: "0 0 6px", display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: "#d97706" }}>⚠</span> Images, text classification and video clip
        classification tasks
      </p>
      <p style={{ fontSize: 13.5, color: "var(--color-text-muted)", lineHeight: 1.55, margin: "0 0 20px" }}>
        This job saves your annotations automatically, so choosing <strong>Confirm</strong>{" "}
        below won't lose any work — you can pick the task back up exactly where you left off.
      </p>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={dontShowAgain} onChange={(e) => setDontShowAgain(e.target.checked)} />
          Don't show this message again.
          <span title="You can always stop and resume a task from the job queue." style={{ color: "var(--color-text-muted)", cursor: "help" }}>
            ⓘ
          </span>
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            onClick={() => onConfirm(dontShowAgain)}
            style={{ background: "#d97706", borderColor: "#d97706", color: "#fff" }}
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--color-text-muted)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  padding: 4,
};
