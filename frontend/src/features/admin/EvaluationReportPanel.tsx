import { Annotation, Job } from "@/shared/api/types";
import {
  buildWordsInOrder,
  buildHierarchyReport,
  prunedChildren,
  transcriptionOf,
  collectWordText,
  isClickableTrue,
  CLICKABLE_LABELS,
  HierarchyNode,
} from "./evaluationReport";

// The on-screen twin of generateEvaluationPdf's PDF — same three sections
// (Overview, Words in reading order by Line, KV/GroupedContainer hierarchy,
// standalone Clickables), rendered as plain HTML instead of a downloaded
// file so it can sit side-by-side with the final annotated document rather
// than forcing a trip out to a separate PDF viewer. Deliberately never
// shows an annotation's raw internal ID (e.g. "[cmtzys5n]") anywhere — that
// string means nothing to whoever is reading this report.
export function EvaluationReportPanel({
  job,
  annotations,
  labelColors,
}: {
  job: Job;
  annotations: Annotation[];
  /** Same color each label's bounding box draws with on the flattened
   *  document (see AdminDocumentPage's buildLabelColorMap) — shown next to
   *  every label mention here so a box's color maps straight to a report
   *  entry, e.g. for training/reviewing against the annotated image. */
  labelColors: Record<string, string>;
}) {
  const { groups, totalWords } = buildWordsInOrder(annotations);
  const { mainRoots, standaloneClickables, orphanWordCount } = buildHierarchyReport(annotations);
  const counts = countsByLabel(annotations);
  const sortedCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const sortedLabels = Object.keys(counts).sort();

  return (
    <div
      style={{
        // Fills whatever height its parent gives it (AdminDocumentPage
        // sizes that parent to the viewport) and scrolls internally once
        // its own content — Words/Hierarchy sections can get long — grows
        // past that, instead of pushing the page taller and dragging the
        // sticky document panel next to it out of view along with it.
        flex: 1,
        minWidth: 320,
        maxWidth: 480,
        height: "100%",
        overflowY: "auto",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        background: "var(--color-surface)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        fontSize: 13,
      }}
    >
      {/* Header band — a distinct block at the top rather than plain
          inline text, so the report reads as its own document rather
          than an extension of whatever panel it sits next to. */}
      <div
        style={{
          padding: "16px 18px 14px",
          borderBottom: "1px solid var(--color-border)",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 7%, transparent), transparent)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: "var(--color-accent)",
              flexShrink: 0,
            }}
          />
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Annotation Structure Report</h3>
        </div>
        <p style={{ margin: "4px 0 0 16px", fontSize: 11.5, color: "var(--color-text-muted)" }}>
          {job.title} · {job.taskType}
        </p>
      </div>

      <div style={{ padding: "14px 18px 18px" }}>
        <SectionHeader>Overview</SectionHeader>
        <p style={{ margin: "6px 0 8px", fontWeight: 600, fontSize: 13 }}>
          Total annotations: <span style={{ color: "var(--color-accent)" }}>{annotations.length}</span>
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
          {sortedCounts.map(([label, n]) => (
            <span key={label} style={countPillStyle}>
              <Swatch color={labelColors[label]} />
              <span style={{ fontWeight: 600 }}>{label}</span>
              <span style={countBadgeStyle}>{n}</span>
            </span>
          ))}
          {sortedCounts.length === 0 && <Muted>No annotations yet.</Muted>}
        </div>

        {/* Same color each label draws with on the annotated document,
            listed once here as a quick-reference legend — so a colored
            bounding box on the doc can be matched to a label at a glance
            without hunting through the Overview pills or the tree below. */}
        <SectionHeader>Label Colors</SectionHeader>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", marginBottom: 4 }}>
          {sortedLabels.map((label) => (
            <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <Swatch color={labelColors[label]} />
              {label}
            </span>
          ))}
          {sortedLabels.length === 0 && <Muted>No annotations yet.</Muted>}
        </div>

        <SectionHeader>Words — Reading Order ({totalWords} total)</SectionHeader>
        {groups.length === 0 && <Muted>No Word annotations.</Muted>}
        {groups.map((group) => (
          // Exactly what was asked for: "Line 1", how many words are under
          // it, then the words themselves — no internal line/word IDs.
          <div key={group.lineId ?? "unlinked"} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                <Swatch color={labelColors.Line} />
                {group.lineLabel}
              </span>
              <span style={countBadgeStyle}>
                {group.words.length} word{group.words.length === 1 ? "" : "s"}
              </span>
            </div>
            {group.words.length === 0 ? (
              <Muted>(no words linked)</Muted>
            ) : (
              <div style={{ color: "var(--color-text)", marginTop: 4, lineHeight: 1.5 }}>
                {group.words.map((wd) => wd.text).join(" ")}
              </div>
            )}
          </div>
        ))}

        <SectionHeader>Key / Value / GroupedContainer Hierarchy</SectionHeader>
        <p style={{ margin: "4px 0 8px", fontSize: 11.5, fontStyle: "italic", color: "var(--color-text-muted)" }}>
          Nesting shown exactly as annotated — a Clickable's Word is only listed when it is TRUE. The dot next to
          each entry matches that label's bounding-box color on the document.
        </p>
        {mainRoots.length === 0 ? (
          <Muted>No Key/Value structure annotated.</Muted>
        ) : (
          <div style={cardStyle}>
            <TreeList nodes={mainRoots} level={0} labelColors={labelColors} />
          </div>
        )}
        {orphanWordCount > 0 && (
          <Muted>
            {orphanWordCount} Word annotation(s) have no Line and no KV/container parent — see "Not linked to a
            Line" above.
          </Muted>
        )}

        <SectionHeader>Clickables Outside Any Value/KV ({standaloneClickables.length})</SectionHeader>
        {standaloneClickables.length === 0 ? (
          <Muted>None — every Clickable sits inside a KV/Value.</Muted>
        ) : (
          <div style={cardStyle}>
            <TreeList nodes={standaloneClickables} level={0} labelColors={labelColors} />
          </div>
        )}
      </div>
    </div>
  );
}

function Swatch({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      style={{
        width: 9,
        height: 9,
        borderRadius: 999,
        background: color ?? "var(--color-text-muted)",
        display: "inline-block",
        flexShrink: 0,
        boxShadow: "0 0 0 1px rgba(0,0,0,0.12)",
      }}
    />
  );
}

function TreeList({
  nodes,
  level,
  labelColors,
}: {
  nodes: HierarchyNode[];
  level: number;
  labelColors: Record<string, string>;
}) {
  return (
    <div
      style={{
        marginLeft: level === 0 ? 0 : 12,
        paddingLeft: level === 0 ? 0 : 10,
        borderLeft: level === 0 ? "none" : "1.5px solid var(--color-border)",
      }}
    >
      {nodes.map((node) => {
        const a = node.annotation;
        const children = prunedChildren(node);
        let text: string;
        let badge: { label: string; color: string; bg: string } | null = null;
        if (a.labelName === "Word") {
          text = `"${transcriptionOf(a) || "(empty)"}"`;
        } else if (CLICKABLE_LABELS.has(a.labelName)) {
          const trueVal = isClickableTrue(a.labelName);
          text = a.labelName;
          badge = trueVal
            ? { label: "TRUE", color: "#7f1d1d", bg: "#fee2e2" }
            : { label: "FALSE", color: "#166534", bg: "#dcfce7" };
        } else {
          const rolled = collectWordText(node);
          text = `${a.labelName}${rolled ? `: "${rolled}"` : ""}`;
        }
        return (
          <div key={a.id} style={{ margin: "4px 0" }}>
            <div
              style={{
                fontWeight: level === 0 ? 600 : 500,
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: level === 0 ? 13 : 12.5,
              }}
            >
              <Swatch color={labelColors[a.labelName]} />
              {a.labelName === "Word" ? (
                <span style={{ color: "var(--color-text-muted)" }}>Word:</span>
              ) : null}
              <span>{text}</span>
              {badge && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    color: badge.color,
                    background: badge.bg,
                    borderRadius: 999,
                    padding: "1px 7px",
                  }}
                >
                  {badge.label}
                </span>
              )}
            </div>
            {children.length > 0 && <TreeList nodes={children} level={level + 1} labelColors={labelColors} />}
          </div>
        );
      })}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4
      style={{
        margin: "18px 0 8px",
        padding: "6px 10px",
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderLeft: "3px solid var(--color-accent)",
        borderRadius: 5,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.2,
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </h4>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "4px 0", fontSize: 12, color: "var(--color-text-muted)" }}>{children}</p>;
}

function countsByLabel(annotations: Annotation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of annotations) counts[a.labelName] = (counts[a.labelName] ?? 0) + 1;
  return counts;
}

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  background: "var(--color-bg)",
  padding: "9px 11px",
  marginBottom: 8,
};

const countPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  padding: "3px 5px 3px 10px",
  background: "var(--color-bg)",
};

const countBadgeStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--color-accent)",
  background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
  borderRadius: 999,
  padding: "1px 8px",
  minWidth: 16,
  textAlign: "center",
};
