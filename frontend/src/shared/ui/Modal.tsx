import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}

// Simple centered overlay modal — used for the delete-with-children
// confirmation dialog (mirrors the reference tool's "Delete N element(s)?"
// popup).
//
// Rendered through a portal straight onto <body>, instead of inline in the
// component tree. Previously this rendered wherever <Modal> happened to sit
// in the workspace layout (inside the flex row with the Konva canvas next
// to it); a fixed-position element normally escapes ancestor overflow, but
// any ancestor that picks up a transform/filter/will-change (Konva's stage
// wrapper, panel drag/resize handling, etc.) turns into a containing block
// that traps it, which is exactly the kind of thing that made the delete
// popup silently fail to show up on top of everything. A body-level portal
// sidesteps that entirely — it's never a descendant of the canvas, so
// nothing it does can reposition or hide the dialog.
export function Modal({ open, onClose, children, width = 420 }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 17, 21, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        pointerEvents: "auto",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "calc(100vw - 48px)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
          background: "var(--color-bg)",
          color: "var(--color-text)",
          borderRadius: 10,
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
          padding: 24,
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
