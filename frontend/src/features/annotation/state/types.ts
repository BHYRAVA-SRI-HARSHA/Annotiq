import { Annotation, BBoxGeometry, LabelDef, PolygonGeometry } from "@/shared/api/types";

export interface AnnotationTreeNode {
  annotation: Annotation;
  children: AnnotationTreeNode[];
}

// Sec. 3 of ANNOTATION_RULES.md: Line grouping and the KV/container
// hierarchy are two independent trees over the same Words. `mode` picks
// which parent pointer to walk — parentAnnotationId for the KV tree,
// lineParentId for the Line tree — so the same flat annotation list can
// render either view in the right-hand panel (Sec. 2.5 "Mode: Line mode").
export type TreeMode = "kv" | "line";

// Sec. 8 of ANNOTATION_RULES.md: the full KV nesting order, deepest to
// shallowest — GroupedContainer > KeyValueContainer > Key/SubKey/Value/
// SubValue > Clickable > Word. Lists, for each annotation type, every
// label it's allowed to sit directly inside — Word and the Clickables
// both have more than one valid immediate parent (a Word might sit in a
// Key, a Value, straight inside a Clickable, or (rarely) straight inside
// a KeyValueContainer with no Key/Value drawn at all).
const KV_PARENT_CANDIDATES: Record<string, string[]> = {
  KeyValueContainer: ["GroupedContainer"],
  Key: ["KeyValueContainer"],
  SubKey: ["Key", "KeyValueContainer"],
  Value: ["KeyValueContainer"],
  SubValue: ["Value", "KeyValueContainer"],
  ClickableItemTrue: ["Key", "SubKey", "Value", "SubValue", "KeyValueContainer"],
  ClickableItemFalse: ["Key", "SubKey", "Value", "SubValue", "KeyValueContainer"],
  Word: ["Key", "SubKey", "Value", "SubValue", "ClickableItemTrue", "ClickableItemFalse", "KeyValueContainer"],
};

// Resolves to whichever of those candidate labels an annotation sits
// inside — checking the formal parentAnnotationId link first (an explicit
// Group action always wins when it already points at a valid immediate
// parent), then falling back to plain geometric containment (a container
// box simply drawn overlapping/enclosing it on the canvas, without ever
// running the explicit Group action). Mirrors tightestContainerAmong
// below; kept in sync so the right-hand tree (Sec. 2.5 "KV mode"), the
// PDF structure report, and pre-submit validation all agree on what's
// "inside" what — a Word bound inside a Key or Value (or a Key/Value
// inside a KeyValueContainer, or a KeyValueContainer inside a
// GroupedContainer) must nest there in the tree instead of showing up
// outside it, next to its container, as its own separate root.
function parentIdFor(a: Annotation, mode: TreeMode, pool: Annotation[]): string | null {
  if (mode === "line") return a.lineParentId;
  const candidates = KV_PARENT_CANDIDATES[a.labelName];
  if (candidates) {
    return tightestContainerAmong(a, pool, candidates)?.id ?? a.parentAnnotationId ?? null;
  }
  return a.parentAnnotationId;
}

export function buildAnnotationTree(annotations: Annotation[], mode: TreeMode = "kv"): AnnotationTreeNode[] {
  // Line mode only concerns Line/Word; KV mode excludes Line (it has its
  // own tree and would otherwise show up as an orphaned root here).
  const relevant =
    mode === "line"
      ? annotations.filter((a) => a.labelName === "Line" || a.labelName === "Word")
      : annotations.filter((a) => a.labelName !== "Line");

  const byId = new Map<string, AnnotationTreeNode>();
  relevant.forEach((a) => byId.set(a.id, { annotation: a, children: [] }));

  const roots: AnnotationTreeNode[] = [];
  byId.forEach((node) => {
    const parentId = parentIdFor(node.annotation, mode, relevant);
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export type LabelVisibility = Record<string, { visible: boolean; locked: boolean }>;

export function defaultVisibility(labels: LabelDef[]): LabelVisibility {
  return Object.fromEntries(labels.map((l) => [l.name, { visible: true, locked: false }]));
}

// Smallest bbox enclosing a set of bboxes — used when grouping selected
// shapes under a new parent container (e.g. several Words -> KeyValueContainer).
export function boundingBoxOf(boxes: BBoxGeometry[]): BBoxGeometry {
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Axis-aligned bbox of a polygon's points — lets a polygon Word (e.g. an
// irregular handwritten-cursive shape) participate in the same edge-snap
// and overlap math as a bbox Word, instead of being silently excluded.
export function polygonBBox(geometry: PolygonGeometry): BBoxGeometry {
  const xs = geometry.points.map((p) => p[0]);
  const ys = geometry.points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

// Any annotation's axis-aligned bbox, regardless of its underlying shape
// type — the single thing snap/overlap logic should call.
export function annotationBBox(a: Annotation): BBoxGeometry {
  return a.shapeType === "BBOX" ? (a.geometry as BBoxGeometry) : polygonBBox(a.geometry as PolygonGeometry);
}

// The actual outline points of a shape — a bbox's 4 corners, or a
// polygon's real vertices. Used for polygon-snap-to-covered-shapes (see
// DocumentCanvas's finishPolygon): unlike annotationBBox, this preserves
// a covered polygon Word's true irregular outline instead of flattening
// it to a rectangle first.
export function annotationOutlinePoints(a: Annotation): Array<[number, number]> {
  if (a.shapeType === "BBOX") {
    const g = a.geometry as BBoxGeometry;
    return [
      [g.x, g.y],
      [g.x + g.width, g.y],
      [g.x + g.width, g.y + g.height],
      [g.x, g.y + g.height],
    ];
  }
  return (a.geometry as PolygonGeometry).points;
}

// Standard monotone-chain convex hull. Given the outline points of every
// shape a newly-drawn polygon covers, this is what lets that polygon snap
// tightly around them — mirroring the bbox tool's "snap to the union of
// what's underneath" behavior (see wordsCoveredBy/boundingBoxOf), but for
// irregular shapes where an axis-aligned union would either clip a
// covered polygon's corners or balloon out well past its actual edges.
export function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const pts = Array.from(new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()).sort(
    (a, b) => a[0] - b[0] || a[1] - b[1]
  );
  if (pts.length <= 2) return pts;

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Array<[number, number]> = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Array<[number, number]> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

export interface ValidationIssue {
  annotationId: string;
  message: string;
}

// A small tolerance in geometry units so a container that's pixel-snug
// around a Key/Value (or off by a rounding fraction) still counts as
// containing it.
const CONTAINMENT_SLOP = 2;

function bboxContains(outer: BBoxGeometry, inner: BBoxGeometry): boolean {
  return (
    inner.x >= outer.x - CONTAINMENT_SLOP &&
    inner.y >= outer.y - CONTAINMENT_SLOP &&
    inner.x + inner.width <= outer.x + outer.width + CONTAINMENT_SLOP &&
    inner.y + inner.height <= outer.y + outer.height + CONTAINMENT_SLOP
  );
}

// A shape counts as "inside" a container whose label is one of
// candidateLabels either because it was formally grouped under one
// (parentAnnotationId — see annotationStore's groupSelected) OR because
// that container box was simply drawn overlapping/enclosing it on the
// canvas — the annotator doesn't have to run the explicit Group action
// for the containment to count, only for a container to actually be
// there on top of it. When more than one candidate box qualifies (e.g. a
// Word whose parentAnnotationId points straight at its KeyValueContainer,
// while a Key box was also drawn tightly around it on the canvas), the
// smallest — tightest-fitting — one wins, since that's the more specific,
// more immediate parent, REGARDLESS of whether it came from the explicit
// link or from geometry. This "smallest of all valid candidates" step is
// what actually matters: picking the explicit link whenever it resolves
// to *any* valid candidate (the previous behavior) meant a Word linked
// straight to its KeyValueContainer stayed there even when a Key/Value
// box was clearly drawn around it — showing up as a direct child of the
// KeyValueContainer instead of nested inside its Key/Value, which is
// exactly the flattened tree the panel and the report were both showing.
// Generalized so it covers every level of the KV hierarchy: Word ->
// Key/SubKey/Value/SubValue/Clickable, Clickable/SubKey/SubValue ->
// Key/Value, Key/Value -> KeyValueContainer, and KeyValueContainer ->
// GroupedContainer.
export function tightestContainerAmong(
  a: Annotation,
  annotations: Annotation[],
  candidateLabels: string[]
): Annotation | undefined {
  if (candidateLabels.length === 0) return undefined;

  const bbox = annotationBBox(a);
  const candidates: Annotation[] = [];

  if (a.parentAnnotationId) {
    const explicitParent = annotations.find((p) => p.id === a.parentAnnotationId);
    if (explicitParent && candidateLabels.includes(explicitParent.labelName)) {
      candidates.push(explicitParent);
    }
  }

  for (const c of annotations) {
    if (c.id === a.id || candidates.includes(c)) continue;
    if (!candidateLabels.includes(c.labelName)) continue;
    if (bboxContains(annotationBBox(c), bbox)) candidates.push(c);
  }

  if (candidates.length === 0) return undefined;
  const areaOf = (x: Annotation) => {
    const g = annotationBBox(x);
    return g.width * g.height;
  };
  return candidates.reduce((best, cur) => (areaOf(cur) < areaOf(best) ? cur : best));
}

// Sec. 8 KV nesting depth (deepest to shallowest is the reverse of these
// numbers): Word(0) < Clickable(1) < Key/SubKey/Value/SubValue(2) <
// KeyValueContainer(3) < GroupedContainer(4). Used below so a container
// drawn on the canvas over already-grouped content (e.g. a Value box
// drawn on top of an existing Clickable and its Words) picks up the
// Clickable itself as a single child — and grows to fully enclose it —
// instead of reaching straight past it to the raw Words underneath and
// leaving the Clickable's edges cut off / orphaned outside its new
// parent.
export const KV_LABEL_RANK: Record<string, number> = {
  Word: 0,
  ClickableItemTrue: 1,
  ClickableItemFalse: 1,
  Key: 2,
  SubKey: 2,
  Value: 2,
  SubValue: 2,
  KeyValueContainer: 3,
  GroupedContainer: 4,
};

// For a Word a newly-drawn container was dragged over, walks up to the
// closest EXISTING shape that already sits strictly between that Word and
// the new container's own level (its rank) — e.g. drawing a Value over a
// Clickable's Words returns that Clickable, not the bare Word. Falls back
// to the Word itself when nothing intermediate exists yet, which is
// exactly the old (pre-existing) behavior for the common case (drawing
// directly over plain, ungrouped Words).
export function immediateCoveredChild(
  word: Annotation,
  annotations: Annotation[],
  newLabelRank: number
): Annotation {
  const candidateLabels = Object.keys(KV_LABEL_RANK).filter(
    (l) => KV_LABEL_RANK[l] > 0 && KV_LABEL_RANK[l] < newLabelRank
  );
  if (candidateLabels.length === 0) return word;
  return tightestContainerAmong(word, annotations, candidateLabels) ?? word;
}

// The one rule that gates *leaving* a Word, whether that's the Quick Edit
// popover's own close (X) button, clicking away to select something else,
// or Escape/empty-canvas-click deselecting it entirely: either it has a
// real transcription, or "Skip Transcription" is on AND a reason is picked
// — Sec. 7.1/7.8 of the rulebook. Returns the message to show (and to
// block the close over) or null when the Word is fine to leave as-is.
// Shared between the popover's inline hints, the store's `select` gate
// (see annotationStore.ts), and the submit-time issues list below so the
// three can never quietly disagree about what "done" means for a Word.
export function getWordCloseError(a: Annotation): string | null {
  if (a.labelName !== "Word") return null;
  if (a.properties.skipTranscription) {
    return a.properties.skipReason ? null : "skip reason is missing";
  }
  return a.properties.transcription?.trim() ? null : "transcription needed";
}

// Key/Value (and SubKey/SubValue) specifically look for a
// KeyValueContainer — kept as its own name since this is the check
// getValidationIssues (and the rest of this file) reads most often.
function containerFor(a: Annotation, annotations: Annotation[]): Annotation | undefined {
  return tightestContainerAmong(a, annotations, ["KeyValueContainer"]);
}

// Everything that must be resolved before a job can be submitted. Currently
// just the one rule from the annotation rulebook (Sec. 7.1/7.8): a skipped
// Word must say why. Add further submit-blocking rules here as the ontology
// grows rather than scattering checks across components.
export function getValidationIssues(annotations: Annotation[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const a of annotations) {
    const wordCloseError = getWordCloseError(a);
    if (wordCloseError) {
      issues.push({ annotationId: a.id, message: `Word: ${wordCloseError}` });
    }

    // Every Word must belong to a Line (Sec. 3: Line grouping is its own
    // independent tree over the Words — see TreeMode/lineParentId above).
    // A freshly-drawn Word has no lineParentId until it's grouped into a
    // Line ("Group into Line" in the left panel), so a Word left ungrouped
    // is flagged the same way an orphaned Key/Value already is below,
    // rather than being silently allowed to sit outside every Line.
    if (a.labelName === "Word" && !a.lineParentId) {
      issues.push({ annotationId: a.id, message: "Word: must belong to a Line" });
    }

    // A Key or Value with no KeyValueContainer above it at all — neither
    // formally grouped nor simply drawn overlapping it — is an orphan the
    // KV tree can't make sense of, so it must be flagged rather than
    // silently accepted. If a container IS there (either way), no error.
    const container = (a.labelName === "Key" || a.labelName === "Value") ? containerFor(a, annotations) : undefined;
    if ((a.labelName === "Key" || a.labelName === "Value") && !container) {
      issues.push({
        annotationId: a.id,
        message: `${a.labelName}: must be inside a KeyValueContainer`,
      });
    }

    // A Key that *is* inside a container but has no sibling Value under
    // that same container is a dangling key — surface it as its own issue
    // rather than reporting the missing-container case above twice.
    if (a.labelName === "Key" && container) {
      const hasValue = annotations.some(
        (v) => v.labelName === "Value" && v.id !== a.id && containerFor(v, annotations)?.id === container.id
      );
      if (!hasValue) {
        issues.push({ annotationId: a.id, message: "Key: value is missing" });
      }
    }

    // The mirror image of the Key check above: a Value that *is* inside a
    // container but has no sibling Key under that same container is just as
    // broken a pair (a value with nothing labelling it) — this side was
    // previously never checked, so a lone Value could sail through QA with
    // no flag at all.
    if (a.labelName === "Value" && container) {
      const hasKey = annotations.some(
        (k) => k.labelName === "Key" && k.id !== a.id && containerFor(k, annotations)?.id === container.id
      );
      if (!hasKey) {
        issues.push({ annotationId: a.id, message: "Value: key is missing" });
      }
    }
  }
  return issues;
}
