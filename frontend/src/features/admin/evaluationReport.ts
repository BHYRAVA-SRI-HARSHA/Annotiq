import { jsPDF } from "jspdf";
import { Annotation, BBoxGeometry, Job, LabelOntology, PolygonGeometry } from "@/shared/api/types";
import { stageAssetId } from "@/shared/format";
import { AnnotationTreeNode, buildAnnotationTree } from "@/features/annotation/state/types";

// ---------------------------------------------------------------------------
// Label -> color map, shared by the flattened annotated-document canvas,
// the on-screen EvaluationReportPanel, and this file's PDF — so the exact
// same color that draws a label's bounding box on the document is the one
// printed next to that label everywhere in the report. Without this, the
// report was just text: there was no way to look at a colored box on the
// document and know which report entry it corresponded to.
// ---------------------------------------------------------------------------

// Fallback palette for labels that have no ontology entry (e.g. no
// LabelOntology row exists yet for this job's task type) — cycles through
// a small fixed set of legible, distinct colors keyed by label name.
export const FALLBACK_PALETTE = ["#4f46e5", "#0d9488", "#dc2626", "#b45309", "#2563eb", "#a21caf", "#16a34a"];

export function buildLabelColorMap(
  annotations: Annotation[],
  ontology: LabelOntology | null
): Record<string, string> {
  const map: Record<string, string> = {};
  const fallbackCache = new Map<string, string>();
  const labelNames = new Set(annotations.map((a) => a.labelName));
  ontology?.labels.forEach((l) => labelNames.add(l.name));
  for (const name of labelNames) {
    const def = ontology?.labels.find((l) => l.name === name);
    if (def) {
      map[name] = def.color;
      continue;
    }
    if (!fallbackCache.has(name)) {
      fallbackCache.set(name, FALLBACK_PALETTE[fallbackCache.size % FALLBACK_PALETTE.length]);
    }
    map[name] = fallbackCache.get(name)!;
  }
  return map;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [80, 80, 80];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

// ---------------------------------------------------------------------------
// "Evaluate" button — PDF structure report
//
// Replaces the old LLM-graded evaluation call. Clicking Evaluate now builds
// a PDF, entirely client-side, straight from the annotation set already
// loaded for this document:
//
//   1. Every Word, in reading order, grouped by the Line it belongs to
//      (Sec. 5 of ANNOTATION_RULES.md — the Line tree, via lineParentId).
//   2. The Key/Value structure — GroupedContainer -> KeyValueContainer ->
//      Key/SubKey + Value/SubValue (Sec. 8 — the container tree, via
//      parentAnnotationId), with Clickables nested wherever they sit inside
//      that structure, plus a separate call-out list of Clickables that
//      aren't inside any KV/Value at all.
//
// The hierarchy is always rendered exactly as annotated: Key/Value ->
// Clickable -> Word, and a Clickable's own Word children only ever get
// listed when that Clickable's state is True (Sec. 8.5/11 — a False/empty
// control has nothing transcribed under it).
//
// Note: jsPDF's built-in fonts only cover Latin-1 — transcriptions in
// scripts outside that range may not render correctly without embedding a
// custom font, which is out of scope here.
// ---------------------------------------------------------------------------

export const CLICKABLE_LABELS = new Set(["ClickableItemTrue", "ClickableItemFalse"]);

const KV_RELATED_LABELS = new Set(["KeyValueContainer", "Key", "SubKey", "Value", "SubValue"]);

function isBBox(g: BBoxGeometry | PolygonGeometry): g is BBoxGeometry {
  return "width" in g;
}

function topLeft(g: BBoxGeometry | PolygonGeometry): { x: number; y: number } {
  if (isBBox(g)) return { x: g.x, y: g.y };
  const xs = g.points.map((p) => p[0]);
  const ys = g.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys) };
}

function byReadingOrder(a: Annotation, b: Annotation): number {
  const ta = topLeft(a.geometry);
  const tb = topLeft(b.geometry);
  return ta.y - tb.y || ta.x - tb.x;
}

export function transcriptionOf(a: Annotation): string {
  const t = a.properties?.transcription;
  if (typeof t === "string" && t.trim()) return t.trim();
  if (a.properties?.skipTranscription) return "⟨skipped⟩";
  return "";
}

export function isClickableTrue(labelName: string): boolean {
  return labelName === "ClickableItemTrue";
}

// --- 1. Words, in reading order, grouped by Line -----------------------

export interface LineWordsGroup {
  lineId: string | null; // null = words with no Line parent at all
  lineLabel: string;
  words: { index: number; id: string; text: string }[];
}

export function buildWordsInOrder(annotations: Annotation[]): { groups: LineWordsGroup[]; totalWords: number } {
  const lines = annotations.filter((a) => a.labelName === "Line").sort(byReadingOrder);
  const words = annotations.filter((a) => a.labelName === "Word");

  const wordsByLine = new Map<string, Annotation[]>();
  const unassigned: Annotation[] = [];
  for (const w of words) {
    if (w.lineParentId) {
      if (!wordsByLine.has(w.lineParentId)) wordsByLine.set(w.lineParentId, []);
      wordsByLine.get(w.lineParentId)!.push(w);
    } else {
      unassigned.push(w);
    }
  }

  let counter = 0;
  const groups: LineWordsGroup[] = lines.map((line, i) => {
    const kids = (wordsByLine.get(line.id) ?? []).sort(byReadingOrder);
    return {
      lineId: line.id,
      lineLabel: `Line ${i + 1}`,
      words: kids.map((w) => ({ index: ++counter, id: w.id, text: transcriptionOf(w) || "(empty)" })),
    };
  });

  if (unassigned.length > 0) {
    const kids = unassigned.sort(byReadingOrder);
    groups.push({
      lineId: null,
      lineLabel: "Not linked to a Line",
      words: kids.map((w) => ({ index: ++counter, id: w.id, text: transcriptionOf(w) || "(empty)" })),
    });
  }

  return { groups, totalWords: counter };
}

// --- 2. Key/Value/GroupedContainer/Clickable hierarchy ------------------

// Reuses the exact same parent-resolution the annotation tool's own
// right-hand tree panel uses (state/types.ts's buildAnnotationTree +
// tightestContainerAmong) — this file used to duplicate that logic with a
// narrower version that only ever walked the raw parentAnnotationId
// pointer. That's what let a GroupedContainer/KeyValueContainer show its
// Words as direct children while the Key/Value "container" in between
// sat empty right next to them, instead of the Words nesting inside
// whichever Key/Value/Clickable box was actually drawn around them.
// Sharing one implementation means the PDF report and the live tree
// panel can never disagree on what's inside what again.
export type HierarchyNode = AnnotationTreeNode;

/**
 * Full tree over every non-Line annotation — see buildAnnotationTree
 * ("kv" mode) in state/types.ts for exactly how each annotation's parent
 * is resolved. Building the report from this shared resolver — rather
 * than re-deriving structure from geometry itself, or trusting only the
 * raw parentAnnotationId pointer — guarantees the PDF matches exactly
 * what the annotation tool itself considers "inside" what.
 */
function buildFullTree(annotations: Annotation[]): { roots: HierarchyNode[] } {
  const roots = buildAnnotationTree(annotations, "kv");

  // Deterministic reading-order at every level — buildAnnotationTree
  // itself doesn't sort (the live tree panel groups roots by label
  // instead), but the PDF report wants strict top-to-bottom,
  // left-to-right reading order throughout.
  function sortByReadingOrder(nodes: HierarchyNode[]) {
    nodes.sort((x, y) => byReadingOrder(x.annotation, y.annotation));
    nodes.forEach((n) => sortByReadingOrder(n.children));
  }
  sortByReadingOrder(roots);

  return { roots };
}

// A Clickable's Word children are only ever meaningful when it's actually
// marked — an unmarked control has nothing transcribed under it (Sec. 8.5 /
// 11.6) — so the printed tree keeps Key/Value/Clickable/Word nesting intact
// but drops a False Clickable's Word children rather than showing them
// anyway.
export function prunedChildren(node: HierarchyNode): HierarchyNode[] {
  const label = node.annotation.labelName;
  if (CLICKABLE_LABELS.has(label) && !isClickableTrue(label)) {
    return node.children.filter((c) => c.annotation.labelName !== "Word");
  }
  return node.children;
}

export interface HierarchyReport {
  mainRoots: HierarchyNode[];
  standaloneClickables: HierarchyNode[];
  orphanWordCount: number;
}

/**
 * Splits the container tree into:
 *  - mainRoots: GroupedContainer / KeyValueContainer / Key / Value (and
 *    similar) roots — the actual Key/Value + GroupedContainer structure,
 *    with any Clickable that sits inside a KV/Value nested exactly where it
 *    was annotated.
 *  - standaloneClickables: every Clickable that has no KeyValueContainer/
 *    Key/Value/SubKey/SubValue anywhere above it — i.e. genuinely outside
 *    any KV, called out on its own since it wouldn't otherwise stand out
 *    buried under a GroupedContainer (or as a bare root).
 */
export function buildHierarchyReport(annotations: Annotation[]): HierarchyReport {
  const { roots } = buildFullTree(annotations);

  const mainRoots = roots.filter((r) => r.annotation.labelName !== "Word" && !CLICKABLE_LABELS.has(r.annotation.labelName));
  const rootClickables = roots.filter((r) => CLICKABLE_LABELS.has(r.annotation.labelName));
  const orphanWordCount = roots.filter((r) => r.annotation.labelName === "Word").length;

  const standaloneClickables: HierarchyNode[] = [...rootClickables];
  function collect(node: HierarchyNode, hasKvAncestor: boolean) {
    if (CLICKABLE_LABELS.has(node.annotation.labelName) && !hasKvAncestor) {
      standaloneClickables.push(node);
    }
    const nextHasKvAncestor = hasKvAncestor || KV_RELATED_LABELS.has(node.annotation.labelName);
    node.children.forEach((c) => collect(c, nextHasKvAncestor));
  }
  mainRoots.forEach((r) => collect(r, KV_RELATED_LABELS.has(r.annotation.labelName)));

  return { mainRoots, standaloneClickables, orphanWordCount };
}

// --- 3. PDF rendering -----------------------------------------------------

const PAGE_WIDTH = 595.28; // A4 pt
const PAGE_HEIGHT = 841.89;
const MARGIN_LEFT = 42;
const MARGIN_RIGHT = 42;
const MARGIN_TOP = 52;
const MARGIN_BOTTOM = 44;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const MAX_INDENT_LEVELS = 9;
const INDENT_STEP = 13;

class ReportWriter {
  doc: jsPDF;
  private y: number;

  constructor() {
    this.doc = new jsPDF({ unit: "pt", format: "a4" });
    this.y = MARGIN_TOP;
  }

  private ensureSpace(height: number) {
    if (this.y + height > PAGE_HEIGHT - MARGIN_BOTTOM) {
      this.doc.addPage();
      this.y = MARGIN_TOP;
    }
  }

  title(text: string) {
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(18);
    this.doc.setTextColor(20, 20, 20);
    this.ensureSpace(26);
    this.doc.text(text, MARGIN_LEFT, this.y);
    this.y += 26;
  }

  meta(text: string) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(100, 100, 100);
    this.ensureSpace(13);
    this.doc.text(text, MARGIN_LEFT, this.y);
    this.y += 13;
  }

  spacer(h = 10) {
    this.y += h;
  }

  hr() {
    this.ensureSpace(12);
    this.doc.setDrawColor(210, 210, 210);
    this.doc.line(MARGIN_LEFT, this.y, PAGE_WIDTH - MARGIN_RIGHT, this.y);
    this.y += 16;
  }

  sectionHeader(text: string) {
    this.ensureSpace(30);
    this.doc.setFillColor(240, 241, 245);
    this.doc.rect(MARGIN_LEFT, this.y - 13, CONTENT_WIDTH, 21, "F");
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(12.5);
    this.doc.setTextColor(20, 20, 20);
    this.doc.text(text, MARGIN_LEFT + 6, this.y + 2);
    this.y += 24;
  }

  subheader(text: string) {
    this.ensureSpace(17);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(10.5);
    this.doc.setTextColor(30, 30, 30);
    this.doc.text(text, MARGIN_LEFT, this.y);
    this.y += 16;
  }

  note(text: string) {
    this.doc.setFont("helvetica", "italic");
    this.doc.setFontSize(9.5);
    this.doc.setTextColor(120, 120, 120);
    const wrapped = this.doc.splitTextToSize(text, CONTENT_WIDTH) as string[];
    for (const w of wrapped) {
      this.ensureSpace(13);
      this.doc.text(w, MARGIN_LEFT, this.y);
      this.y += 13;
    }
  }

  // swatchHex: draws a small filled circle in the given label color right
  // before the text (first wrapped line only) — the PDF's equivalent of
  // the colored dot next to each label in the on-screen report, so a box's
  // color on the flattened document maps straight to the entry here.
  line(
    text: string,
    opts: { level?: number; bold?: boolean; color?: [number, number, number]; size?: number; swatchHex?: string } = {}
  ) {
    const level = Math.min(opts.level ?? 0, MAX_INDENT_LEVELS);
    const indent = level * INDENT_STEP;
    const size = opts.size ?? 9.5;
    const [r, g, b] = opts.color ?? [25, 25, 25];
    const swatchGap = opts.swatchHex ? 10 : 0;
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(r, g, b);
    const maxWidth = Math.max(60, CONTENT_WIDTH - indent - swatchGap);
    const wrapped = this.doc.splitTextToSize(text, maxWidth) as string[];
    wrapped.forEach((w, i) => {
      this.ensureSpace(size + 4.5);
      if (i === 0 && opts.swatchHex) {
        const [sr, sg, sb] = hexToRgb(opts.swatchHex);
        this.doc.setFillColor(sr, sg, sb);
        this.doc.circle(MARGIN_LEFT + indent + 3, this.y - size * 0.32, 3, "F");
      }
      this.doc.text(w, MARGIN_LEFT + indent + swatchGap, this.y);
      this.y += size + 4.5;
    });
  }

  save(filename: string) {
    this.doc.save(filename);
  }
}


// A Key/Value/KeyValueContainer/GroupedContainer almost never carries its
// own transcription — the actual text lives on the Word leaves nested
// underneath it (directly, or one level further down inside a Clickable).
// Rather than making the reader hunt through several nested indent levels
// to find that text, pull it up onto the container's own summary line too.
// Respects the same "only a TRUE Clickable's Words count" rule as the tree
// itself (prunedChildren) so a Value that's blank because its Clickable is
// unmarked correctly reads as blank here, not as leaking the control's
// unused label text.
export function collectWordText(node: HierarchyNode): string {
  const own = transcriptionOf(node.annotation);
  if (own) return own;
  const texts: string[] = [];
  function walk(n: HierarchyNode) {
    for (const child of prunedChildren(n)) {
      if (child.annotation.labelName === "Word") {
        const t = transcriptionOf(child.annotation);
        if (t) texts.push(t);
      } else {
        walk(child);
      }
    }
  }
  walk(node);
  return texts.join(" ");
}

// One line describing a node: label, its True/False state for a Clickable,
// and either its own transcription or (for structural nodes like
// Key/Value/KeyValueContainer) the transcription rolled up from the Words
// nested underneath it, so e.g. a Key line reads
// `Key: "GST"` and its Value line reads `Value: "647383"` directly,
// instead of both showing blank with the text buried a level deeper.
// Internal annotation IDs are deliberately never shown here — they're
// meaningless to whoever reads this report and just add clutter.
function nodeHeading(node: HierarchyNode): { text: string; color?: [number, number, number] } {
  const a = node.annotation;
  if (a.labelName === "Word") {
    return { text: `Word: "${transcriptionOf(a) || "(empty)"}"`, color: [25, 25, 25] };
  }
  if (CLICKABLE_LABELS.has(a.labelName)) {
    const true_ = isClickableTrue(a.labelName);
    return {
      text: `${a.labelName} — ${true_ ? "TRUE (marked)" : "FALSE (unmarked)"}`,
      color: true_ ? [127, 29, 29] : [22, 101, 52],
    };
  }
  const text = collectWordText(node);
  return { text: `${a.labelName}${text ? `: "${text}"` : ""}`, color: [17, 24, 39] };
}

function renderTree(w: ReportWriter, nodes: HierarchyNode[], level: number, labelColors: Record<string, string>) {
  for (const node of nodes) {
    const { text, color } = nodeHeading(node);
    w.line(text, {
      level,
      bold: level === 0,
      color,
      size: level === 0 ? 10 : 9.5,
      swatchHex: labelColors[node.annotation.labelName],
    });
    const children = prunedChildren(node);
    if (children.length > 0) renderTree(w, children, level + 1, labelColors);
  }
}

function countsByLabel(annotations: Annotation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of annotations) counts[a.labelName] = (counts[a.labelName] ?? 0) + 1;
  return counts;
}

// Builds the report PDF and returns the jsPDF document plus its suggested
// filename, WITHOUT saving/downloading it — lets a caller either save it
// standalone (w.save(filename)) or bundle its blob into a zip alongside
// the flattened document image (see AdminDocumentPage's handleDownload).
export function buildEvaluationPdf(
  job: Job,
  annotations: Annotation[],
  labelColors: Record<string, string>,
  group: "prod" | "qa" = "prod"
): { doc: jsPDF; filename: string } {
  const w = new ReportWriter();

  w.title("Annotation Structure Report");
  w.meta(`Asset: ${job.title}    ·    Asset ID: ${stageAssetId(job, group)}`);
  w.meta(`Task type: ${job.taskType}    ·    Status: ${job.status}`);
  w.meta(`Generated: ${new Date().toLocaleString()}`);
  w.spacer(6);
  w.hr();

  // --- Overview -----------------------------------------------------
  const counts = countsByLabel(annotations);
  w.sectionHeader("Overview");
  w.line(`Total annotations: ${annotations.length}`, { bold: true });
  w.spacer(2);
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([label, n]) => w.line(`${label}: ${n}`, { level: 1, swatchHex: labelColors[label] }));
  w.spacer(6);

  // --- Label colors legend -------------------------------------------
  // Same color that draws each label's bounding box on the flattened
  // document, printed next to its name — lets a reader (or an LLM being
  // trained on this report) map a box's color straight to what it means,
  // without cross-referencing the annotation tool itself.
  w.subheader("Label colors");
  Object.keys(counts)
    .sort()
    .forEach((label) => w.line(label, { level: 1, swatchHex: labelColors[label] }));
  w.spacer(10);

  // --- 1. Words, in reading order, by Line ---------------------------
  const { groups, totalWords } = buildWordsInOrder(annotations);
  w.sectionHeader(`1. Words — Reading Order (${totalWords} total)`);
  if (groups.length === 0) {
    w.line("No Word annotations.");
  }
  for (const group of groups) {
    w.subheader(`${group.lineLabel} (${group.words.length} word${group.words.length === 1 ? "" : "s"})`);
    if (group.words.length === 0) {
      w.line("(no words linked)", { level: 1, color: [140, 140, 140] });
    } else {
      const text = group.words.map((wd) => `${wd.index}. ${wd.text}`).join("   ");
      w.line(text, { level: 1, swatchHex: labelColors.Word });
    }
    w.spacer(4);
  }
  w.spacer(6);

  // --- 2. Key/Value + GroupedContainer hierarchy ----------------------
  const { mainRoots, standaloneClickables, orphanWordCount } = buildHierarchyReport(annotations);
  w.sectionHeader("2. Key / Value / GroupedContainer Hierarchy");
  w.note("Nesting shown exactly as annotated: GroupedContainer -> KeyValueContainer -> Key/Value -> Clickable -> Word (a Clickable's Word is only listed when it is TRUE). The dot next to each entry is that label's bounding-box color on the document.");
  w.spacer(6);
  if (mainRoots.length === 0) {
    w.line("No Key/Value structure annotated.");
  } else {
    renderTree(w, mainRoots, 0, labelColors);
  }
  if (orphanWordCount > 0) {
    w.spacer(4);
    w.note(`${orphanWordCount} Word annotation(s) have no Line and no KV/container parent — see "Not linked to a Line" above.`);
  }
  w.spacer(10);

  // --- 3. Clickables outside any Value/KV -----------------------------
  w.sectionHeader(`3. Clickables Outside Any Value/KV (${standaloneClickables.length})`);
  w.note("Every Clickable that has no KeyValueContainer/Key/Value above it — annotated independently per the Clickables SOP.");
  w.spacer(6);
  if (standaloneClickables.length === 0) {
    w.line("None — every Clickable sits inside a KV/Value.");
  } else {
    renderTree(w, standaloneClickables, 0, labelColors);
  }

  const filename = `${job.title.replace(/[^a-z0-9-_]+/gi, "_")}-${job.id}-annotation-report.pdf`;
  return { doc: w.doc, filename };
}

// Back-compat convenience wrapper — builds the PDF and saves/downloads it
// immediately as its own standalone file.
export function generateEvaluationPdf(job: Job, annotations: Annotation[], labelColors: Record<string, string>): void {
  const { doc, filename } = buildEvaluationPdf(job, annotations, labelColors);
  doc.save(filename);
}
