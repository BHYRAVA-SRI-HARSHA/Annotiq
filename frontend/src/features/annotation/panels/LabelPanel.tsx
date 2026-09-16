import { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { createPortal } from "react-dom";
import { useAnnotationStore } from "../state/annotationStore";
import {
  BoxIcon,
  ChevronDownIcon,
  CursorIcon,
  EyeIcon,
  EyeOffIcon,
  GridIcon,
  InfoIcon,
  KeyValueIcon,
  LinkIcon,
  LockIcon,
  PolygonIcon,
  TextLineIcon,
  UnlockIcon,
} from "@/shared/ui/icons";

interface LabelPanelProps {
  assetId?: string;
  batch?: string;
  page?: number;
}

// Sec. 2.4 of ANNOTATION_RULES.md: picking a label here is how the tool
// decides what the next drawn shape becomes — mirrors the "Select a label
// to start drawing" prompt in the reference tool. The full label list is
// grouped into three PHASES (Word / Line / Key & Value) rather than one
// long flat list — each phase is its own expandable button so annotators
// go straight to the small set of labels relevant to whatever pass
// they're on (e.g. doing a first "just box every Word" pass shouldn't
// require scanning past eight KV labels every time).
const PHASES: { key: string; title: string; labels: string[] }[] = [
  { key: "word", title: "Word", labels: ["Word"] },
  { key: "line", title: "Line", labels: ["Line"] },
  {
    key: "kv",
    title: "Key & Value",
    labels: [
      "Key",
      "Value",
      "SubKey",
      "SubValue",
      "ClickableItemTrue",
      "ClickableItemFalse",
      "KeyValueContainer",
      "GroupedContainer",
    ],
  },
];

export function LabelPanel({ assetId, batch, page = 1 }: LabelPanelProps) {
  const ontology = useAnnotationStore((s) => s.ontology);
  const annotations = useAnnotationStore((s) => s.annotations);
  const labelVisibility = useAnnotationStore((s) => s.labelVisibility);
  const toggleVisibility = useAnnotationStore((s) => s.toggleLabelVisibility);
  const toggleLock = useAnnotationStore((s) => s.toggleLabelLock);
  const setAllLabelsVisible = useAnnotationStore((s) => s.setAllLabelsVisible);
  const setLabelsVisible = useAnnotationStore((s) => s.setLabelsVisible);
  const activeLabelName = useAnnotationStore((s) => s.activeLabelName);
  const setActiveLabel = useAnnotationStore((s) => s.setActiveLabel);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const selectedIds = useAnnotationStore((s) => s.selectedIds);
  const groupSelected = useAnnotationStore((s) => s.groupSelected);
  const groupSelectedAsLine = useAnnotationStore((s) => s.groupSelectedAsLine);
  const showParentChildLinks = useAnnotationStore((s) => s.showParentChildLinks);
  const toggleShowParentChildLinks = useAnnotationStore((s) => s.toggleShowParentChildLinks);
  const stats = useAnnotationStore((s) => s.stats);

  const [infoOpen, setInfoOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  function phaseOfLabel(name: string | null): string | null {
    if (!name) return null;
    return PHASES.find((p) => p.labels.includes(name))?.key ?? null;
  }
  // Accordion — one phase open at a time. Starts open on whichever phase
  // contains the already-active label (e.g. resuming a task mid-Word-pass
  // shouldn't collapse back to nothing selected-looking); clicking the
  // open phase's own header collapses it again.
  const [openPhase, setOpenPhase] = useState<string | null>(() => phaseOfLabel(activeLabelName));

  useEffect(() => {
    if (!infoOpen) return;
    function onOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (infoRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setInfoOpen(false);
    }
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, [infoOpen]);

  // Popover is rendered in a portal (see below) so it can float freely over
  // the canvas instead of being clipped by this panel's overflow-y:auto —
  // so its position has to be computed from the trigger button's actual
  // screen position rather than relying on CSS position:absolute here.
  useEffect(() => {
    if (!infoOpen || !infoButtonRef.current) return;
    const rect = infoButtonRef.current.getBoundingClientRect();
    const width = 280;
    const left = Math.min(rect.left, window.innerWidth - width - 12);
    setPopoverPos({ top: rect.bottom + 8, left: Math.max(left, 12) });
  }, [infoOpen]);

  const canGroup = selectedIds.length >= 2;

  // Sec. 2 counts — Words / Lines / KVs (KeyValueContainer instances) /
  // Grouped Containers — filled into what used to be dead empty space at
  // the bottom of this panel, right below the Group-into-container /
  // Group-into-Line buttons (which only show up once 2+ shapes are
  // selected; this summary is always visible so the space is never
  // empty). Recomputed straight from the live annotation list rather than
  // a separately-tracked counter, so it can never drift out of sync with
  // undo/redo, deletions, etc.
  const counts = useMemo(() => {
    let words = 0;
    let lines = 0;
    let kvs = 0;
    let groupedContainers = 0;
    for (const a of annotations) {
      if (a.labelName === "Word") words++;
      else if (a.labelName === "Line") lines++;
      else if (a.labelName === "KeyValueContainer") kvs++;
      else if (a.labelName === "GroupedContainer") groupedContainers++;
    }
    return { words, lines, kvs, groupedContainers };
  }, [annotations]);

  function colorOf(name: string): string {
    return ontology?.labels.find((l) => l.name === name)?.color ?? "var(--color-text-muted)";
  }

  return (
    <div
      className="workspace-panel"
      style={{
        // Shrinks down to 160px on narrow viewports instead of staying
        // rigid at 226px and crushing the document canvas to nothing —
        // flexShrink is enabled and width comes from a clamp() so this
        // scales smoothly as the window (or panel) is resized.
        width: "clamp(160px, 20vw, 226px)",
        flex: "0 1 clamp(160px, 20vw, 226px)",
        minWidth: 0,
        borderRight: "1px solid var(--color-border)",
        overflowY: "auto",
        overflowX: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--color-bg)",
        fontSize: 13,
      }}
    >
      <div ref={infoRef} className="panel-header" style={{ position: "relative" }}>
        <span className="panel-header__dot" />
        {/* "Keys and Values" -> "Labels" — this panel covers every phase
            (Word/Line/KV), not just the KV one, so the old title read as
            though the Word/Line labels below it didn't belong here.
            Slightly heavier weight + tighter letter-spacing than the
            plain default title font so it reads as a deliberate section
            title rather than just larger body text. */}
        <span
          className="panel-header__title"
          style={{ flex: 1, fontWeight: 700, letterSpacing: 0.2, fontFamily: "var(--font-heading, inherit)" }}
        >
          Labels
        </span>
        <button
          ref={infoButtonRef}
          onClick={() => setInfoOpen((v) => !v)}
          title="View file info"
          style={{ ...bareIconBtnStyle, color: "var(--color-text-muted)" }}
        >
          <InfoIcon size={16} />
        </button>

        {infoOpen && popoverPos &&
          createPortal(
            <FileInfoPopover
              ref={popoverRef}
              assetId={assetId}
              batch={batch}
              page={page}
              stats={stats}
              top={popoverPos.top}
              left={popoverPos.left}
            />,
            document.body
          )}
      </div>

      <div style={{ padding: "12px 14px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
        <SectionHeader
          title="Phases"
          onShowAll={() => setAllLabelsVisible(true)}
          onHideAll={() => setAllLabelsVisible(false)}
        />

        <div style={{ marginBottom: 4, display: "flex", flexDirection: "column", gap: 6 }}>
          {PHASES.map((phase) => {
            const isOpen = openPhase === phase.key;
            // Word/Line are single-label phases — their own label's color
            // stands in for the whole phase. Key & Value bundles eight
            // different-colored labels, so instead of picking one
            // arbitrary color to represent all of them, it gets a small
            // cluster of dots (one per label, deduped by color) — still
            // "matches their respective bounding colours" per-label, just
            // shown up front on the collapsed button too.
            const phaseColors = Array.from(new Set(phase.labels.map(colorOf)));
            // A phase reads as "visible" only once every one of its labels
            // is — same all-or-nothing convention as the individual
            // per-label eye below. Mixed states (some shown, some hidden)
            // show as the "hidden" (crossed-out) icon so clicking it always
            // does the obvious thing: show everything in the phase.
            const phaseVisible = phase.labels.every((name) => labelVisibility[name]?.visible ?? true);
            return (
              <div key={phase.key}>
                <div
                  onClick={() => setOpenPhase(isOpen ? null : phase.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenPhase(isOpen ? null : phase.key);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  className={`side-row${isOpen ? " side-row--active" : ""}`}
                  style={{
                    width: "100%",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontWeight: 600,
                    background: isOpen ? undefined : "var(--color-bg)",
                    font: "inherit",
                    color: "inherit",
                    cursor: "pointer",
                  }}
                >
                  {phaseColors.length === 1 ? (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 999,
                        background: phaseColors[0],
                        display: "inline-block",
                        flexShrink: 0,
                        boxShadow: "0 0 0 2px var(--color-bg)",
                      }}
                    />
                  ) : (
                    <span style={{ display: "inline-flex", flexShrink: 0 }}>
                      {phaseColors.slice(0, 4).map((c, i) => (
                        <span
                          key={c}
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: 999,
                            background: c,
                            display: "inline-block",
                            boxShadow: "0 0 0 1.5px var(--color-bg)",
                            marginLeft: i === 0 ? 0 : -3,
                          }}
                        />
                      ))}
                    </span>
                  )}
                  <span style={{ flex: 1, textAlign: "left" }}>{phase.title}</span>
                  <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 400 }}>
                    {phase.labels.length}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      // Don't let this bubble up to the row's own
                      // open/close handler — this button only ever
                      // flips visibility for every label in the phase.
                      e.stopPropagation();
                      setLabelsVisible(phase.labels, !phaseVisible);
                    }}
                    title={phaseVisible ? `Hide all ${phase.title}` : `Show all ${phase.title}`}
                    aria-label={phaseVisible ? `Hide all ${phase.title}` : `Show all ${phase.title}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 22,
                      height: 22,
                      padding: 0,
                      border: "none",
                      background: "none",
                      borderRadius: 5,
                      color: phaseVisible ? "var(--color-text-muted)" : "var(--color-text-faint, var(--color-text-muted))",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {phaseVisible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
                  </button>
                  <ChevronDownIcon
                    size={14}
                    style={{
                      transform: isOpen ? "rotate(180deg)" : "none",
                      transition: "transform 0.15s ease",
                      color: "var(--color-text-muted)",
                    }}
                  />
                </div>

                {isOpen && (
                  <div style={{ paddingLeft: 6, marginTop: 2 }}>
                    {phase.labels.map((labelName) => {
                      const label = ontology?.labels.find((l) => l.name === labelName);
                      if (!label) return null;
                      const vis = labelVisibility[label.name];
                      const isActive = activeLabelName === label.name;
                      const isVisible = vis?.visible ?? true;
                      const isLocked = vis?.locked ?? false;
                      return (
                        <div
                          key={label.name}
                          onClick={() => setActiveLabel(label.name, label.shape)}
                          className={`side-row${isActive ? " side-row--active" : ""}`}
                        >
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 999,
                              background: label.color,
                              display: "inline-block",
                              flexShrink: 0,
                              boxShadow: "0 0 0 2px var(--color-bg)",
                            }}
                          />
                          <span
                            style={{
                              flex: 1,
                              textDecoration: isVisible ? "none" : "line-through",
                              color: isVisible ? "var(--color-text)" : "var(--color-text-muted)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {label.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleVisibility(label.name);
                            }}
                            title={isVisible ? "Hide label" : "Show label"}
                            style={{ ...bareIconBtnStyle, color: isVisible ? "var(--color-text-muted)" : "#c94f4f" }}
                          >
                            {isVisible ? <EyeIcon /> : <EyeOffIcon />}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLock(label.name);
                            }}
                            title={isLocked ? "Unlock label" : "Lock label"}
                            style={{ ...bareIconBtnStyle, color: isLocked ? "var(--color-accent)" : "var(--color-text-muted)" }}
                          >
                            {isLocked ? <LockIcon /> : <UnlockIcon />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!activeLabelName && (
          <p
            style={{
              fontSize: 12,
              color: "var(--color-amber)",
              background: "var(--color-amber-soft)",
              border: "1px solid var(--color-amber)",
              borderRadius: "var(--radius-sm)",
              padding: "8px 10px",
              margin: "4px 0 14px",
            }}
          >
            Select a label to start drawing.
          </p>
        )}

        <button
          onClick={() => setActiveTool("select")}
          style={{
            ...toolBtnStyle,
            justifyContent: "flex-start",
            marginTop: activeLabelName ? 14 : 0,
            marginBottom: 14,
            ...(activeTool === "select" ? toolBtnActiveStyle : {}),
          }}
        >
          <CursorIcon style={{ marginRight: 8 }} />
          <span style={{ flex: 1, textAlign: "left" }}>Select / Move</span>
          <span style={{ opacity: 0.7, fontSize: 11 }}>S</span>
        </button>

        {/* Manual shape override: a label's `shape` in the ontology just
            picks the *default* tool when it's clicked (see setActiveLabel),
            but an annotator drawing e.g. an irregular handwritten Word still
            needs a way to reach for a polygon instead of a bbox on demand —
            these two buttons make that choice explicit rather than tying it
            solely to which label happens to be selected. */}
        {activeLabelName && (
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            <button
              onClick={() => setActiveTool("bbox")}
              title="Draw as a rectangle"
              style={{
                ...toolBtnStyle,
                flex: 1,
                justifyContent: "center",
                ...(activeTool === "bbox" ? toolBtnActiveStyle : {}),
              }}
            >
              <BoxIcon style={{ marginRight: 6 }} />
              BBox
            </button>
            <button
              onClick={() => setActiveTool("polygon")}
              title="Draw as a polygon"
              style={{
                ...toolBtnStyle,
                flex: 1,
                justifyContent: "center",
                ...(activeTool === "polygon" ? toolBtnActiveStyle : {}),
              }}
            >
              <PolygonIcon style={{ marginRight: 6 }} />
              Polygon
            </button>
          </div>
        )}

        <RowButton
          icon={<LinkIcon />}
          label="Show Parent - Child Links"
          active={showParentChildLinks}
          onClick={toggleShowParentChildLinks}
        />
        <RowButton icon={<GridIcon />} label="Select for Group" active={false} onClick={() => {}} />

        {canGroup && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 4px" }}>
            <button
              onClick={() => {
                const parentLabel = window.prompt(
                  "Group into which label? (e.g. KeyValueContainer, GroupedContainer)",
                  "KeyValueContainer"
                );
                if (parentLabel) groupSelected(parentLabel);
              }}
              style={toolBtnStyle}
            >
              Group into container ({selectedIds.length})
            </button>
            <button onClick={groupSelectedAsLine} style={toolBtnStyle}>
              Group into Line ({selectedIds.length})
            </button>
          </div>
        )}

        {/* Sec. 2's counts summary — pinned to the bottom of the panel
            (marginTop: auto, inside this flex column) so it fills what
            used to just be blank space below everything above, whether or
            not the Group buttons are currently showing. */}
        <div
          style={{
            marginTop: "auto",
            paddingTop: 12,
            borderTop: "1px solid var(--color-border)",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
          }}
        >
          <CountTile label="Words" value={counts.words} color={colorOf("Word")} icon={<BoxIcon size={12} />} />
          <CountTile label="Lines" value={counts.lines} color={colorOf("Line")} icon={<TextLineIcon size={12} />} />
          <CountTile label="KVs" value={counts.kvs} color={colorOf("KeyValueContainer")} icon={<KeyValueIcon size={12} />} />
          <CountTile
            label="Grouped"
            value={counts.groupedContainers}
            color={colorOf("GroupedContainer")}
            icon={<GridIcon size={11} />}
          />
        </div>
      </div>
    </div>
  );
}

// Sec. 2 counts tile — was a plain bordered box with a flat colored left
// bar; now a small stat card: a colored icon badge (so Words/Lines/KVs/
// Grouped read as distinct element types, not four identical boxes), a
// soft tint of the label's own ontology color washing the card background,
// and the count promoted to the most prominent thing in the tile since
// it's the number an annotator actually scans this row for.
function CountTile({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "8px 9px",
        background: `linear-gradient(160deg, ${color}17, ${color}03 65%)`,
        boxShadow: `inset 0 1.5px 0 0 ${color}66`,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 19,
            height: 19,
            flexShrink: 0,
            borderRadius: 6,
            background: `${color}22`,
            color,
          }}
        >
          {icon}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1, color: "var(--color-text)" }}>{value}</div>
    </div>
  );
}

function SectionHeader({ title, onShowAll, onHideAll }: { title: string; onShowAll: () => void; onHideAll: () => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <span className="section-label" style={{ display: "block", marginBottom: 6 }}>
        <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--color-amber)" }} />
        {title.toUpperCase()}
      </span>
      {/* Show all / Hide all used to be small inline text-links sharing a
          row with the section title, which wrapped onto their own second
          line on this panel's narrower widths (see the clamp() above).
          Now a full-width two-up row of its own, each button stretching
          to share the space evenly (flex: 1) — side by side at any panel
          width instead of wrapping. */}
      <div style={{ display: "flex", gap: 6 }}>
        <button className="chip-link" style={stretchChipStyle} onClick={onShowAll}>
          Show all
        </button>
        <button className="chip-link" style={stretchChipStyle} onClick={onHideAll}>
          Hide all
        </button>
      </div>
    </div>
  );
}

const stretchChipStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "center",
};

function RowButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        border: "none",
        background: "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
        fontSize: 13,
        cursor: "pointer",
        padding: "6px 2px",
        textAlign: "left",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const FileInfoPopover = forwardRef<
  HTMLDivElement,
  {
    assetId?: string;
    batch?: string;
    page: number;
    stats: ReturnType<typeof useAnnotationStore.getState>["stats"];
    top: number;
    left: number;
  }
>(function FileInfoPopover({ assetId, batch, page, stats, top, left }, ref) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const elapsedMs = now - stats.sessionStart;
  const idleMs = Math.max(0, elapsedMs - stats.activeMs);
  const toFirstMs = stats.firstActionAt ? stats.firstActionAt - stats.sessionStart : elapsedMs;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top,
        left,
        width: 280,
        maxHeight: "calc(100vh - 24px)",
        overflowY: "auto",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
        padding: "14px 16px",
        zIndex: 1000,
        fontSize: 12.5,
      }}
    >
      <InfoGroup title="File info">
        <InfoRow label="Asset ID" value={assetId ?? "—"} wrap />
        <InfoRow label="Batch" value={batch ?? "—"} />
        <InfoRow label="Page" value={String(page)} />
        <InfoRow label="Rework round" value="0" />
      </InfoGroup>
      <InfoGroup title="Element">
        <InfoRow label="Created · newly added" value={String(stats.elementsCreated)} />
        <InfoRow label="Modified · co-ordinates modified" value={String(stats.elementsModified)} />
        <InfoRow label="Deleted · removed" value={String(stats.elementsDeleted)} />
      </InfoGroup>
      <InfoGroup title="Characteristics">
        <InfoRow label="Created · newly added" value={String(stats.propsCreated)} />
        <InfoRow label="Modified · characteristics modified" value={String(stats.propsModified)} />
        <InfoRow label="Deleted · removed" value={String(stats.propsDeleted)} />
      </InfoGroup>
      <InfoGroup title="Session" last>
        <InfoRow label="Total" value={formatDuration(elapsedMs)} />
        <InfoRow label="Active" value={formatDuration(stats.activeMs)} />
        <InfoRow label="Idle" value={formatDuration(idleMs)} />
        <InfoRow label="To first action" value={formatDuration(toFirstMs)} />
        <InfoRow label="Saves" value={String(stats.saves)} />
        <InfoRow label="Undo / Redo" value={`${stats.undoCount} / ${stats.redoCount}`} />
      </InfoGroup>
    </div>
  );
});

function InfoGroup({ title, children, last }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ marginBottom: last ? 0 : 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: "var(--color-text-muted)", marginBottom: 4 }}>
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
      <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right", wordBreak: wrap ? "break-all" : "normal" }}>{value}</span>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const bareIconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 3,
};

const toolBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  padding: "8px 12px",
  fontSize: 13,
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  background: "var(--color-bg)",
  cursor: "pointer",
  color: "var(--color-text)",
};

const toolBtnActiveStyle: React.CSSProperties = {
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
  borderColor: "var(--color-accent)",
  fontWeight: 700,
};
