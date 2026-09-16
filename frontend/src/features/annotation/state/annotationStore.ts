import { create } from "zustand";
import { api } from "@/shared/api/client";
import { Annotation, LabelOntology, ShapeType } from "@/shared/api/types";
import { LabelVisibility, defaultVisibility, boundingBoxOf, annotationBBox, TreeMode, getWordCloseError } from "./types";
import { defaultWordColorVisibility } from "./wordColors";

// Container labels that are meant to auto-tighten around their children
// (per the reference tool's own left-panel hint: "Drag around
// KeyValueContainer, Word — the GroupedContainer box will tighten around
// them") rather than stay wherever they were first drawn/created. Key,
// Value, SubKey, SubValue etc. also have a parentAnnotationId, but they're
// independent boxes the annotator draws on purpose — only these "wrapper"
// labels are supposed to passively follow their children's edges.
// ClickableItemTrue/False included: a Clickable snaps to the union of its
// Words the moment it's first drawn (see wordsCoveredBy in DocumentCanvas),
// but without being in this set that was a one-time snap only — if one of
// its Words was later dragged/resized (or removed), the Clickable's box
// went stale and stopped matching what was actually underneath it. Adding
// it here means a Clickable keeps re-tightening to its Words' bounds any
// time one of them moves, the same way GroupedContainer/KeyValueContainer
// already do for theirs.
const AUTO_FIT_CONTAINER_LABELS = new Set([
  "GroupedContainer",
  "KeyValueContainer",
  "ClickableItemTrue",
  "ClickableItemFalse",
]);

// After a child shape's geometry changes (drag/resize) or a child is
// removed, any ancestor GroupedContainer/KeyValueContainer box needs to
// re-tighten to the union of its (possibly now different) children —
// otherwise the container box goes stale and stops matching the edges of
// what's actually inside it. Walks upward from each touched parent so
// nested containers (a GroupedContainer inside another, in principle) all
// refit, not just the immediate one.
function refitAutoFitAncestors(annotations: Annotation[], startParentIds: Iterable<string>): Annotation[] {
  let next = annotations;
  let parentId: string | null | undefined;
  const queue = [...new Set(startParentIds)];
  const seen = new Set<string>();
  while (queue.length > 0) {
    parentId = queue.shift();
    if (!parentId || seen.has(parentId)) continue;
    seen.add(parentId);

    const parent = next.find((a) => a.id === parentId);
    if (!parent || !AUTO_FIT_CONTAINER_LABELS.has(parent.labelName)) continue;

    const children = next.filter((a) => a.parentAnnotationId === parentId);
    if (children.length === 0) continue; // orphaned container — leave its box as-is

    const tightGeometry = boundingBoxOf(children.map(annotationBBox));
    next = next.map((a) => (a.id === parentId ? { ...a, geometry: tightGeometry } : a));

    // The container we just resized might itself be nested inside another
    // auto-fit container — queue its parent too.
    if (parent.parentAnnotationId) queue.push(parent.parentAnnotationId);
  }
  return next;
}

function tempId(): string {
  return `tmp-${crypto.randomUUID()}`;
}

function isTempId(id: string): boolean {
  return id.startsWith("tmp-");
}

interface IdMapEntry {
  clientId: string;
  id: string;
}

interface SaveResponse {
  savedAt: string;
  idMap: IdMapEntry[];
}

export type DeleteMode = "only" | "children" | "all" | "cancel";

export interface PendingDeleteRequest {
  rootIds: string[];
  childCount: number;
}

// Session/file-info counters shown in the left panel's "View file info"
// popover (Sec. 2.4). Kept intentionally simple: cumulative counts that
// persist for the life of the job (they do not reset on save), plus a
// lightweight heartbeat-based active/idle split.
export interface SessionStats {
  sessionStart: number;
  lastActionAt: number;
  firstActionAt: number | null;
  activeMs: number;
  elementsCreated: number;
  elementsModified: number;
  elementsDeleted: number;
  propsCreated: number;
  propsModified: number;
  propsDeleted: number;
  saves: number;
  undoCount: number;
  redoCount: number;
}

function freshStats(): SessionStats {
  const now = Date.now();
  return {
    sessionStart: now,
    lastActionAt: now,
    firstActionAt: null,
    activeMs: 0,
    elementsCreated: 0,
    elementsModified: 0,
    elementsDeleted: 0,
    propsCreated: 0,
    propsModified: 0,
    propsDeleted: 0,
    saves: 0,
    undoCount: 0,
    redoCount: 0,
  };
}

// A user is considered "active" if some mutation happened in the last 30s;
// the heartbeat below (ticked every 5s) accrues time into activeMs while
// that holds, so "Idle" in the info popover is just elapsed - activeMs.
const ACTIVE_WINDOW_MS = 30_000;
const HEARTBEAT_MS = 5_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// Walks both the KV tree (parentAnnotationId) and the Line tree
// (lineParentId) to find every descendant of `id`. `trees` controls which
// pointer(s) count as "child" for this pass.
function collectDescendants(
  annotations: Annotation[],
  id: string,
  trees: Array<"kv" | "line">
): Annotation[] {
  const directChildren = annotations.filter(
    (a) =>
      (trees.includes("kv") && a.parentAnnotationId === id) ||
      (trees.includes("line") && a.lineParentId === id)
  );
  return directChildren.reduce<Annotation[]>(
    (acc, child) => [...acc, child, ...collectDescendants(annotations, child.id, trees)],
    []
  );
}

// Classifies a properties patch into created/modified/deleted counts for
// the "Characteristics" section of the file-info popover — a flag/field
// going from empty to set is "created", set to empty is "deleted", and a
// changed non-empty value is "modified".
function classifyPropsPatch(
  prev: Record<string, unknown>,
  patch: Record<string, unknown>
): { created: number; modified: number; deleted: number } {
  let created = 0;
  let modified = 0;
  let deleted = 0;
  const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || v === false;
  Object.entries(patch).forEach(([key, next]) => {
    const prevVal = prev[key];
    const wasEmpty = isEmpty(prevVal);
    const nowEmpty = isEmpty(next);
    if (wasEmpty && !nowEmpty) created += 1;
    else if (!wasEmpty && nowEmpty) deleted += 1;
    else if (!wasEmpty && !nowEmpty && prevVal !== next) modified += 1;
  });
  return { created, modified, deleted };
}

interface AnnotationState {
  jobId: string | null;
  annotations: Annotation[];
  ontology: LabelOntology | null;
  labelVisibility: LabelVisibility;
  wordColorVisibility: Record<string, boolean>;
  showParentChildLinks: boolean;

  // selection: selectedIds drives multi-select (grouping); selectedAnnotationId
  // is always the last-clicked one and is what the Properties panel shows.
  selectedIds: string[];
  selectedAnnotationId: string | null;

  // Set by `select`/`clearSelection` whenever they refuse to move the
  // selection away from a Word that isn't finished yet (Sec. 7.1/7.8: a
  // real transcription, or Skip Transcription + a reason) — see
  // getWordCloseError in types.ts. The Quick Edit popover reads this to
  // show an explicit "Transcription needed"/"Skip reason is missing"
  // banner right when the blocked close was attempted, instead of only
  // the passive inline hint under the field. Cleared on the next
  // successful select/clearSelection/updateProperties call.
  blockedWordClose: { annotationId: string; message: string } | null;

  // Bumped every time focusAnnotation() is called (e.g. clicking a
  // validation issue in the right panel) so the canvas can react even when
  // the target is already the current selection — a plain id/selection
  // compare wouldn't re-fire in that case. See DocumentCanvas's effect on
  // this field, which pans/centers the stage on the target shape.
  focusRequestId: string | null;
  focusToken: number;

  activeTool: "select" | "bbox" | "polygon";
  activeLabelName: string | null;
  treeMode: TreeMode; // Sec. 2.5 — right panel "Mode: Line mode" toggle

  dirtyIds: Set<string>;
  pendingDeleteIds: Set<string>;
  // Snapshots of `annotations` taken right before each undoable edit.
  // Cleared on every successful save() — once a change is saved it's
  // committed, and Ctrl+Z should only ever undo work made *since* the
  // last save, never silently revert something already persisted.
  undoStack: Annotation[][];
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  stats: SessionStats;

  // Delete-confirmation flow (Sec. "Delete N elements?" dialog): opening a
  // request pauses for the user's choice; resolveDeleteRequest carries it out.
  pendingDeleteRequest: PendingDeleteRequest | null;

  loadJob: (jobId: string, taskType: string) => Promise<void>;
  setActiveTool: (tool: AnnotationState["activeTool"]) => void;
  setActiveLabel: (labelName: string, shape: "bbox" | "polygon") => void;
  setTreeMode: (mode: TreeMode) => void;

  select: (id: string | null, additive?: boolean, opts?: { force?: boolean }) => void;
  clearSelection: () => void;
  // Selects an annotation AND asks the canvas to pan/center on it — use
  // this (instead of select) from anywhere outside the canvas that needs
  // the shape to actually be scrolled into view, e.g. clicking a
  // validation issue in the right panel.
  focusAnnotation: (id: string) => void;

  toggleLabelVisibility: (labelName: string) => void;
  toggleLabelLock: (labelName: string) => void;
  setAllLabelsVisible: (visible: boolean) => void;
  // Sets visibility for a whole PHASE's worth of labels in one shot (the
  // Labels panel's per-phase eye icon — Word / Line / Key & Value) without
  // touching any label outside that group, unlike setAllLabelsVisible.
  setLabelsVisible: (labelNames: string[], visible: boolean) => void;

  toggleWordColorVisibility: (key: string) => void;
  setAllWordColorsVisible: (visible: boolean) => void;
  toggleShowParentChildLinks: () => void;

  createAnnotation: (labelName: string, shapeType: ShapeType, geometry: Annotation["geometry"]) => string;
  updateGeometry: (id: string, geometry: Annotation["geometry"]) => void;
  updateProperties: (id: string, properties: Partial<Annotation["properties"]>) => void;
  setLineParent: (id: string, lineParentId: string | null) => void;
  // Links one or more Words (or any children) to a container annotation's
  // parentAnnotationId in a single batched update — used when a Key/Value/
  // SubKey/SubValue box is drawn directly over existing Words, the same
  // moment that box's geometry snaps to their union (see wordsCoveredBy in
  // DocumentCanvas). Before this, that snap was purely visual: the Words
  // were never actually linked as children, so the KV tree (and anything
  // built from it, like the PDF report) saw the container as childless
  // even though it visibly covered real transcribed text.
  linkChildrenToParent: (childIds: string[], parentId: string) => void;
  deleteAnnotation: (id: string) => void;
  deleteSelected: () => void;
  // Opens the confirm dialog when the selection has children; deletes
  // immediately (no dialog) when every selected shape is a leaf.
  requestDeleteSelected: () => void;
  resolveDeleteRequest: (mode: DeleteMode) => void;

  // Ctrl+Z: pops the most recent pre-edit snapshot and restores it. A
  // no-op (silently) once the stack is empty — either nothing's been
  // edited yet this session, or everything undoable has already been
  // saved (see undoStack's own doc comment).
  undo: () => void;
  // Records an undo checkpoint without changing anything — call once at
  // the start of a drag/resize/vertex-move gesture (before any
  // updateGeometry calls for it) so the whole gesture undoes as one step.
  beginUndoableEdit: () => void;

  // Wraps selected Words under a new KeyValueContainer/GroupedContainer/etc.
  groupSelected: (parentLabelName: string) => void;
  // Wraps selected Words under a new Line — independent tree, see types.ts.
  groupSelectedAsLine: () => void;
  // Snaps a freshly-drawn "Line" box to the union of the Words it was drawn
  // over, and links those Words into it (Sec. 5.1's "line adjusts to word
  // edges" behavior) — used by the canvas when the Line label is active.
  createSnappedLine: (words: Annotation[]) => string;

  // `opts.keepalive` is only ever passed from the "hard refresh / tab
  // close" flush (see AnnotationWorkspacePage's beforeunload/pagehide
  // handler): it tells the underlying fetch to keep the request alive for
  // a moment after the page starts navigating away, which a normal fetch
  // would otherwise just abort mid-flight.
  save: (opts?: { keepalive?: boolean }) => Promise<void>;
}

const UNDO_STACK_LIMIT = 50;

// Tracks the currently-running save() call, if any — see the concurrency
// guard at the top of save() for why overlapping autosave/manual-save/
// pre-submit calls need to be serialized rather than firing concurrent
// PATCH requests against the same job.
let inFlightSave: Promise<void> | null = null;

export const useAnnotationStore = create<AnnotationState>((set, get) => {
  // Called at the top of every mutating action, BEFORE it changes
  // `annotations`, so the stack always holds "what it looked like right
  // before this edit" states in edit order.
  function pushUndo() {
    set((s) => ({ undoStack: [...s.undoStack, s.annotations].slice(-UNDO_STACK_LIMIT) }));
  }

  return {
  jobId: null,
  annotations: [],
  ontology: null,
  labelVisibility: {},
  wordColorVisibility: defaultWordColorVisibility(),
  showParentChildLinks: false,
  selectedIds: [],
  selectedAnnotationId: null,
  blockedWordClose: null,
  focusRequestId: null,
  focusToken: 0,
  activeTool: "select",
  activeLabelName: null,
  treeMode: "kv",
  dirtyIds: new Set(),
  pendingDeleteIds: new Set(),
  undoStack: [],
  isDirty: false,
  isSaving: false,
  lastSavedAt: null,
  stats: freshStats(),
  pendingDeleteRequest: null,

  loadJob: async (jobId, taskType) => {
    const annotations = await api.get<Annotation[]>(`/jobs/${jobId}/annotations`);
    // Deliberately NOT Promise.all'd with the annotations fetch above: if
    // this task type has no seeded LabelOntology, the ontology request
    // 404s, and a Promise.all would reject *before* the set() below ever
    // ran — leaving whatever job was loaded into the store previously
    // sitting there under the new job's document image. That's a real
    // cross-job leak (open job A, then a job B whose ontology is missing,
    // and B's canvas silently renders A's annotations on top of B's
    // image), not just a missing-labels inconvenience. Ontology failing
    // now only means an empty LABELS panel — it never blocks annotations
    // from loading for the job actually being opened.
    let ontology: LabelOntology | null = null;
    let ontologyError: unknown = null;
    try {
      ontology = await api.get<LabelOntology>(`/ontologies/${taskType}`);
    } catch (err) {
      ontologyError = err;
    }

    set({
      jobId,
      annotations,
      ontology,
      labelVisibility: defaultVisibility(ontology?.labels ?? []),
      wordColorVisibility: defaultWordColorVisibility(),
      showParentChildLinks: false,
      selectedIds: [],
      selectedAnnotationId: null,
      blockedWordClose: null,
      activeTool: "select",
      activeLabelName: null,
      dirtyIds: new Set(),
      pendingDeleteIds: new Set(),
      isDirty: false,
      stats: freshStats(),
    });

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      set((s) => {
        const now = Date.now();
        const isActive = now - s.stats.lastActionAt < ACTIVE_WINDOW_MS;
        if (!isActive) return {};
        return { stats: { ...s.stats, activeMs: s.stats.activeMs + HEARTBEAT_MS } };
      });
    }, HEARTBEAT_MS);

    // Surfaced last, now that annotations/ontology state above is already
    // correctly applied either way — the caller (AnnotationWorkspacePage)
    // still wants to know about this to show its own banner.
    if (ontologyError) throw ontologyError;
  },

  setActiveTool: (tool) => set({ activeTool: tool }),
  setTreeMode: (mode) => set({ treeMode: mode }),

  // Picking a label in the LabelPanel is how the reference tool decides
  // what shape gets drawn next — mirrors its "Select a label to start
  // drawing" prompt.
  setActiveLabel: (labelName, shape) =>
    set({ activeLabelName: labelName, activeTool: shape }),

  select: (id, additive = false, opts) =>
    set((s) => {
      // Gate leaving the currently-selected Word (see getWordCloseError):
      // re-clicking the SAME word isn't "leaving" it, additive
      // shift/ctrl-click selection doesn't drop the current word out of
      // the selection either way, and `force` is the escape hatch for
      // callers that must be allowed through regardless (deletion already
      // clears selectedAnnotationId itself before this ever runs — see
      // deleteAnnotation — so in practice this is here for future callers,
      // not a currently-exercised path).
      if (!opts?.force && !additive && s.selectedAnnotationId && s.selectedAnnotationId !== id) {
        const current = s.annotations.find((a) => a.id === s.selectedAnnotationId);
        const message = current ? getWordCloseError(current) : null;
        if (message) {
          return { blockedWordClose: { annotationId: current!.id, message } };
        }
      }
      if (id === null) return { selectedIds: [], selectedAnnotationId: null, blockedWordClose: null };
      if (additive) {
        const already = s.selectedIds.includes(id);
        const selectedIds = already ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id];
        return { selectedIds, selectedAnnotationId: id, blockedWordClose: null };
      }
      return { selectedIds: [id], selectedAnnotationId: id, blockedWordClose: null };
    }),

  clearSelection: () => get().select(null),

  focusAnnotation: (id) =>
    set((s) => ({
      selectedIds: [id],
      selectedAnnotationId: id,
      focusRequestId: id,
      focusToken: s.focusToken + 1,
    })),

  toggleLabelVisibility: (labelName) =>
    set((s) => ({
      labelVisibility: {
        ...s.labelVisibility,
        [labelName]: {
          ...s.labelVisibility[labelName],
          visible: !s.labelVisibility[labelName]?.visible,
        },
      },
    })),

  toggleLabelLock: (labelName) =>
    set((s) => ({
      labelVisibility: {
        ...s.labelVisibility,
        [labelName]: {
          ...s.labelVisibility[labelName],
          locked: !s.labelVisibility[labelName]?.locked,
        },
      },
    })),

  setAllLabelsVisible: (visible) =>
    set((s) => ({
      labelVisibility: Object.fromEntries(
        Object.entries(s.labelVisibility).map(([name, v]) => [name, { ...v, visible }])
      ),
    })),

  setLabelsVisible: (labelNames, visible) =>
    set((s) => {
      const names = new Set(labelNames);
      const next = { ...s.labelVisibility };
      for (const name of names) {
        next[name] = { ...next[name], visible };
      }
      return { labelVisibility: next };
    }),

  toggleWordColorVisibility: (key) =>
    set((s) => ({
      wordColorVisibility: { ...s.wordColorVisibility, [key]: !(s.wordColorVisibility[key] ?? true) },
    })),

  setAllWordColorsVisible: (visible) =>
    set((s) => ({
      wordColorVisibility: Object.fromEntries(Object.keys(s.wordColorVisibility).map((k) => [k, visible])),
    })),

  toggleShowParentChildLinks: () => set((s) => ({ showParentChildLinks: !s.showParentChildLinks })),

  createAnnotation: (labelName, shapeType, geometry) => {
    pushUndo();
    const { jobId } = get();
    const id = tempId();
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id,
      jobId: jobId ?? "",
      labelName,
      shapeType,
      geometry,
      // Every Word defaults to Printed (Sec. 6) so it immediately reads with
      // its WritingType color instead of looking "uncolored" until someone
      // manually opens its properties — annotators only need to flip this
      // for the minority of words that are actually handwritten.
      properties: labelName === "Word" ? { writingType: "Printed" } : {},
      parentAnnotationId: null,
      lineParentId: null,
      createdById: "",
      createdAt: now,
      updatedAt: now,
    };
    set((s) => {
      const nowMs = Date.now();
      return {
        annotations: [...s.annotations, annotation],
        dirtyIds: new Set(s.dirtyIds).add(id),
        isDirty: true,
        selectedIds: [id],
        selectedAnnotationId: id,
        stats: {
          ...s.stats,
          elementsCreated: s.stats.elementsCreated + 1,
          lastActionAt: nowMs,
          firstActionAt: s.stats.firstActionAt ?? nowMs,
        },
      };
    });
    return id;
  },

  // Undo for drags/resizes is pushed by the CALLER (see beginUndoableEdit,
  // called once from the canvas's onDragStart/onTransformStart) rather
  // than automatically in here — updateGeometry fires on every intermediate
  // onDragMove for a polygon vertex, and auto-pushing here would flood the
  // undo stack with one entry per pixel of mouse movement instead of one
  // entry per gesture.
  updateGeometry: (id, geometry) => {
    set((s) => {
      const nowMs = Date.now();
      const moved = s.annotations.map((a) => (a.id === id ? { ...a, geometry } : a));
      const movedShape = moved.find((a) => a.id === id);
      const refitted = movedShape?.parentAnnotationId
        ? refitAutoFitAncestors(moved, [movedShape.parentAnnotationId])
        : moved;
      // Any container that actually got re-tightened above also needs to
      // be marked dirty so the resize is part of the next save, not just
      // the shape the user dragged.
      const dirtyIds = new Set(s.dirtyIds).add(id);
      refitted.forEach((a, i) => {
        if (a !== moved[i]) dirtyIds.add(a.id);
      });
      return {
        annotations: refitted,
        dirtyIds,
        isDirty: true,
        stats: {
          ...s.stats,
          elementsModified: s.stats.elementsModified + 1,
          lastActionAt: nowMs,
          firstActionAt: s.stats.firstActionAt ?? nowMs,
        },
      };
    });
  },

  updateProperties: (id, properties) => {
    pushUndo();
    set((s) => {
      const target = s.annotations.find((a) => a.id === id);
      const delta = target
        ? classifyPropsPatch(target.properties as Record<string, unknown>, properties as Record<string, unknown>)
        : { created: 0, modified: 0, deleted: 0 };
      const nowMs = Date.now();
      return {
        annotations: s.annotations.map((a) =>
          a.id === id ? { ...a, properties: { ...a.properties, ...properties } } : a
        ),
        dirtyIds: new Set(s.dirtyIds).add(id),
        isDirty: true,
        // Any edit to the blocked Word's own properties clears the banner
        // immediately rather than waiting for the next (now-successful)
        // close attempt — the moment they type a transcription or pick a
        // skip reason, the warning should just go away.
        blockedWordClose: s.blockedWordClose?.annotationId === id ? null : s.blockedWordClose,
        stats: {
          ...s.stats,
          propsCreated: s.stats.propsCreated + delta.created,
          propsModified: s.stats.propsModified + delta.modified,
          propsDeleted: s.stats.propsDeleted + delta.deleted,
          lastActionAt: nowMs,
          firstActionAt: s.stats.firstActionAt ?? nowMs,
        },
      };
    });
  },

  setLineParent: (id, lineParentId) => {
    pushUndo();
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, lineParentId } : a)),
      dirtyIds: new Set(s.dirtyIds).add(id),
      isDirty: true,
    }));
  },

  // Deliberately does NOT push its own undo snapshot — every current
  // caller uses this as the second half of a single user gesture that
  // already called createAnnotation (which does push) a moment earlier,
  // e.g. drawing a Value box over some Words. Undoing that createAnnotation
  // call restores the pre-draw annotations array, which already implies
  // undoing this link too, so a second push here would mean one Ctrl+Z
  // only partially undoes the draw and a second press is needed to finish
  // the job — exactly the kind of multi-step-undo bug already reported.
  linkChildrenToParent: (childIds, parentId) => {
    const idSet = new Set(childIds);
    set((s) => ({
      annotations: s.annotations.map((a) => (idSet.has(a.id) ? { ...a, parentAnnotationId: parentId } : a)),
      dirtyIds: new Set([...s.dirtyIds, ...childIds, parentId]),
      isDirty: true,
    }));
  },

  deleteAnnotation: (id) => {
    pushUndo();
    set((s) => {
      const pendingDeleteIds = new Set(s.pendingDeleteIds);
      if (!isTempId(id)) pendingDeleteIds.add(id);
      const dirtyIds = new Set(s.dirtyIds);
      dirtyIds.delete(id);
      const nowMs = Date.now();
      const removedParentId = s.annotations.find((a) => a.id === id)?.parentAnnotationId ?? null;
      // orphan any children rather than cascade-delete client-side; the
      // parent link is just cleared — and that clearing has to actually
      // reach the server, or the child keeps pointing at a parent id that
      // no longer exists there once this delete is saved. (Previously
      // only ancestors touched by refitAutoFitAncestors below got marked
      // dirty here, so an orphaned child's cleared parentAnnotationId
      // never made it into a save's upserts at all — a real, silently
      // broken relation, not just an undo/redo quirk.)
      const orphanedChildIds: string[] = [];
      const withoutId = s.annotations
        .filter((a) => a.id !== id)
        .map((a) => {
          if (a.parentAnnotationId !== id) return a;
          orphanedChildIds.push(a.id);
          return { ...a, parentAnnotationId: null };
        });
      orphanedChildIds.forEach((childId) => dirtyIds.add(childId));
      // The deleted shape's own parent (if a GroupedContainer/
      // KeyValueContainer) has one fewer child now — re-tighten it too, or
      // it keeps the space the deleted shape used to occupy.
      const finalAnnotations = removedParentId ? refitAutoFitAncestors(withoutId, [removedParentId]) : withoutId;
      finalAnnotations.forEach((a, i) => {
        if (a !== withoutId[i]) dirtyIds.add(a.id);
      });
      return {
        annotations: finalAnnotations,
        pendingDeleteIds,
        dirtyIds,
        isDirty: dirtyIds.size > 0 || pendingDeleteIds.size > 0,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        selectedAnnotationId: s.selectedAnnotationId === id ? null : s.selectedAnnotationId,
        stats: {
          ...s.stats,
          elementsDeleted: s.stats.elementsDeleted + 1,
          lastActionAt: nowMs,
          firstActionAt: s.stats.firstActionAt ?? nowMs,
        },
      };
    });
  },

  // Legacy direct-delete path (kept for callers that intentionally want to
  // skip the confirmation dialog, e.g. undo). Prefer requestDeleteSelected.
  deleteSelected: () => {
    const { selectedIds, deleteAnnotation } = get();
    selectedIds.forEach((id) => deleteAnnotation(id));
  },

  requestDeleteSelected: () => {
    const { annotations, selectedIds } = get();
    if (selectedIds.length === 0) return;

    const childIds = new Set<string>();
    selectedIds.forEach((id) => {
      collectDescendants(annotations, id, ["kv", "line"]).forEach((c) => childIds.add(c.id));
    });
    // Don't double-count a selected shape that is also a descendant of
    // another selected shape.
    selectedIds.forEach((id) => childIds.delete(id));

    if (childIds.size === 0) {
      // Leaf shape(s) only — delete immediately, no popup needed.
      selectedIds.forEach((id) => get().deleteAnnotation(id));
      return;
    }

    set({ pendingDeleteRequest: { rootIds: [...selectedIds], childCount: childIds.size } });
  },

  resolveDeleteRequest: (mode) => {
    const { pendingDeleteRequest, annotations } = get();
    if (!pendingDeleteRequest) return;
    const { rootIds } = pendingDeleteRequest;

    if (mode === "cancel") {
      set({ pendingDeleteRequest: null });
      return;
    }

    if (mode === "only") {
      // Delete just the selected element(s); children are orphaned (their
      // parent pointer is cleared), matching "keep children".
      rootIds.forEach((id) => get().deleteAnnotation(id));
      set({ pendingDeleteRequest: null });
      return;
    }

    if (mode === "children") {
      // Cascade through the KV/container tree only — Line associations
      // ("lines & links") on the deleted descendants are preserved by
      // simply not walking the lineParentId pointer.
      const toDelete = new Set<string>(rootIds);
      rootIds.forEach((id) => collectDescendants(annotations, id, ["kv"]).forEach((c) => toDelete.add(c.id)));
      toDelete.forEach((id) => get().deleteAnnotation(id));
      set({ pendingDeleteRequest: null });
      return;
    }

    // mode === "all": cascade through both trees — every descendant and
    // every line/link association goes with it.
    const toDelete = new Set<string>(rootIds);
    rootIds.forEach((id) => collectDescendants(annotations, id, ["kv", "line"]).forEach((c) => toDelete.add(c.id)));
    toDelete.forEach((id) => get().deleteAnnotation(id));
    set({ pendingDeleteRequest: null });
  },

  // Wraps every currently-selected annotation under a new container shape
  // (e.g. select several Word boxes -> Group -> KeyValueContainer), matching
  // the reference tool's GroupedContainer/KeyValueContainer behavior. Works
  // for polygon-shaped children too (via their axis-aligned bbox) — this
  // used to only consider BBOX shapes and silently drop polygon Words.
  groupSelected: (parentLabelName) => {
    const { annotations, selectedIds } = get();
    if (selectedIds.length < 2) return;

    const children = annotations.filter((a) => selectedIds.includes(a.id));
    if (children.length === 0) return;

    const parentGeometry = boundingBoxOf(children.map(annotationBBox));
    const parentId = get().createAnnotation(parentLabelName, "BBOX", parentGeometry);

    set((s) => ({
      annotations: s.annotations.map((a) =>
        selectedIds.includes(a.id) ? { ...a, parentAnnotationId: parentId } : a
      ),
      dirtyIds: new Set([...s.dirtyIds, ...selectedIds, parentId]),
      isDirty: true,
      selectedIds: [parentId],
      selectedAnnotationId: parentId,
    }));
  },

  // Sec. 5.1's "4-space rule" grouping — selected Words become one Line.
  // Uses lineParentId, the independent tree, so this never disturbs
  // whatever KV nesting those same Words already have.
  groupSelectedAsLine: () => {
    const { annotations, selectedIds } = get();
    if (selectedIds.length < 2) return;

    const words = annotations.filter((a) => selectedIds.includes(a.id));
    if (words.length === 0) return;

    const lineId = get().createSnappedLine(words);
    set({ selectedIds: [lineId], selectedAnnotationId: lineId });
  },

  // Shared by groupSelectedAsLine and the canvas's "draw a Line box over
  // some Words" flow: the Line's geometry always snaps to the exact union
  // of the Words it contains, and each Word is linked to it. Uses
  // annotationBBox so polygon-shaped Words (handwritten/irregular) snap
  // correctly too, instead of only bbox Words.
  createSnappedLine: (words) => {
    const lineGeometry = boundingBoxOf(words.map(annotationBBox));
    const lineId = get().createAnnotation("Line", "BBOX", lineGeometry);
    const wordIds = new Set(words.map((w) => w.id));

    set((s) => ({
      annotations: s.annotations.map((a) => (wordIds.has(a.id) ? { ...a, lineParentId: lineId } : a)),
      dirtyIds: new Set([...s.dirtyIds, ...wordIds, lineId]),
      isDirty: true,
    }));

    return lineId;
  },

  save: async (opts) => {
    // Concurrency guard: autosave's debounce timer, the manual Save
    // button, and the pre-Submit/pre-Stop-and-resume saves can all fire
    // close together, and a big batch can legitimately take a few seconds
    // (see the transaction timeout note in annotations.routes.ts). Without
    // this, a second save() starting while the first is still in flight
    // sends a second overlapping PATCH — two concurrent transactions
    // racing over the same job's rows — which is exactly the kind of bug
    // that shows up as "sometimes a Value, sometimes a KeyValueContainer"
    // vanishing on reopen: each transaction resolves parent pointers from
    // its own snapshot of upserts, so whichever one's Phase 2 commits last
    // can silently stomp the other's freshly-linked parentAnnotationId
    // with a stale value. If a save is already running, wait for it, then
    // check whether there's still anything new to persist rather than
    // just dropping this call.
    if (inFlightSave) {
      await inFlightSave.catch(() => {}); // the earlier call already surfaces its own error
      return get().save(opts);
    }

    const { jobId, annotations, dirtyIds, pendingDeleteIds } = get();
    if (!jobId || (dirtyIds.size === 0 && pendingDeleteIds.size === 0)) return;

    const runSave = async () => {
      set({ isSaving: true });

    // Snapshot exactly which ids this specific request is about to send —
    // NOT a reference to the live Set, which the user can keep adding to
    // while this request is in flight (they aren't blocked from editing
    // during an autosave). The response handler below must only clear
    // *these* ids when it lands, not blindly reset to empty: a plain
    // `dirtyIds: new Set()` would silently erase the record of any edit
    // made during the round-trip, leaving it looking saved (isDirty back
    // to false) when the server never actually received it.
    const sentDirtyIds = new Set(dirtyIds);
    const sentPendingDeleteIds = new Set(pendingDeleteIds);

    const dirtyAnnotations = annotations.filter((a) => sentDirtyIds.has(a.id));
    const upserts = dirtyAnnotations.map((a) => ({
      id: isTempId(a.id) ? undefined : a.id,
      clientId: a.id,
      labelName: a.labelName,
      shapeType: a.shapeType,
      geometry: a.geometry,
      properties: a.properties,
      parentAnnotationId: a.parentAnnotationId,
      lineParentId: a.lineParentId,
    }));

    try {
      const res = await api.patch<SaveResponse>(
        `/jobs/${jobId}/annotations`,
        {
          upserts,
          deletedIds: Array.from(sentPendingDeleteIds),
        },
        opts?.keepalive ? { keepalive: true } : undefined
      );

      const idMap = new Map(res.idMap.map((e) => [e.clientId, e.id]));

      set((s) => {
        const remainingDirtyIds = new Set([...s.dirtyIds].filter((id) => !sentDirtyIds.has(id)));
        const remainingPendingDeleteIds = new Set(
          [...s.pendingDeleteIds].filter((id) => !sentPendingDeleteIds.has(id))
        );
        return {
          annotations: s.annotations.map((a) => {
            const realId = idMap.get(a.id);
            const remappedParent = a.parentAnnotationId ? idMap.get(a.parentAnnotationId) ?? a.parentAnnotationId : null;
            const remappedLineParent = a.lineParentId ? idMap.get(a.lineParentId) ?? a.lineParentId : null;
            return {
              ...a,
              id: realId ?? a.id,
              parentAnnotationId: remappedParent,
              lineParentId: remappedLineParent,
            };
          }),
          dirtyIds: remainingDirtyIds,
          pendingDeleteIds: remainingPendingDeleteIds,
          // Only clear the undo stack once everything is actually saved —
          // if new edits landed while this request was in flight (still
          // sitting in remainingDirtyIds), wiping the whole stack here
          // would erase undo history for work the server was never even
          // sent yet, on top of the already-fixed issue of stomping its
          // dirty flag.
          undoStack: remainingDirtyIds.size === 0 && remainingPendingDeleteIds.size === 0 ? [] : s.undoStack,
          isDirty: remainingDirtyIds.size > 0 || remainingPendingDeleteIds.size > 0,
          isSaving: false,
          lastSavedAt: res.savedAt,
          stats: { ...s.stats, saves: s.stats.saves + 1 },
          selectedIds: s.selectedIds.map((id) => idMap.get(id) ?? id),
          selectedAnnotationId: s.selectedAnnotationId
            ? idMap.get(s.selectedAnnotationId) ?? s.selectedAnnotationId
            : null,
        };
      });
    } catch (err) {
      set({ isSaving: false });
      throw err;
    }
    };

    inFlightSave = runSave().finally(() => {
      inFlightSave = null;
    });
    return inFlightSave;
  },

  beginUndoableEdit: () => pushUndo(),

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    const current = get().annotations;
    // Anything whose id existed in the restored snapshot but with
    // different content (or didn't exist there at all — i.e. it was
    // created since) needs to be marked dirty again so the undo itself
    // gets persisted on the next save, the same as any other edit.
    const prevById = new Map(previous.map((a) => [a.id, a]));
    const touchedIds = new Set<string>();
    current.forEach((a) => {
      const before = prevById.get(a.id);
      if (!before || JSON.stringify(before) !== JSON.stringify(a)) touchedIds.add(a.id);
    });
    previous.forEach((a) => {
      if (!current.some((c) => c.id === a.id)) touchedIds.add(a.id);
    });
    set((s) => ({
      annotations: previous,
      undoStack: s.undoStack.slice(0, -1),
      dirtyIds: new Set([...s.dirtyIds, ...touchedIds]),
      // Undoing a delete brings the annotation back into `previous` — it
      // must stop being treated as "pending server-side deletion", or the
      // next save both deletes and updates that same row in the same
      // transaction (Prisma throws updating a row its own deleteMany just
      // removed, which fails the *entire* save — every other unrelated
      // change queued in that save fails right along with it, including
      // any parent/child relation fix-ups). This was the "Save doesn't
      // work" bug: it only ever showed up after a Ctrl+Z of a delete.
      pendingDeleteIds: new Set([...s.pendingDeleteIds].filter((id) => !prevById.has(id))),
      isDirty: true,
      selectedIds: [],
      selectedAnnotationId: null,
      blockedWordClose: null,
    }));
  },
  };
});
