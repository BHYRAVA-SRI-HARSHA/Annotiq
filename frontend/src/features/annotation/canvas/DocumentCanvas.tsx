import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Rect, Line, Circle, Transformer } from "react-konva";
import Konva from "konva";
import { useAnnotationStore } from "../state/annotationStore";
import { Annotation, BBoxGeometry, PolygonGeometry } from "@/shared/api/types";
import {
  boundingBoxOf,
  annotationBBox,
  annotationOutlinePoints,
  convexHull,
  KV_LABEL_RANK,
  immediateCoveredChild,
} from "../state/types";
import { WordQuickEditPopover } from "./WordQuickEditPopover";
import { wordColorFor, isWordHiddenByColorToggle } from "../state/wordColors";
import { FitScreenIcon, MinusIcon, PlusIcon } from "@/shared/ui/icons";

interface DocumentCanvasProps {
  imageUrl: string;
  /** View-only mode (QA's locked review screen before the "QA" button is
   *  clicked): panning and zooming still work, but nothing can be drawn,
   *  dragged, resized, deleted, or opened for editing. */
  readOnly?: boolean;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 16;
// Screen-space (unscaled) pixel radius: clicking within this distance of a
// polygon's first vertex closes the shape instead of adding another point.
const CLOSE_THRESHOLD_PX = 10;

// Fills are meant to read as a clear, visible highlight over the source
// text (like a highlighter marker) — not just a barely-there tint. Every
// shape (BBox, Polygon, Transformer, in-progress previews) pulls its
// numbers from here so the whole canvas stays visually consistent and
// easy to re-tune from one place.
const SHAPE_STYLE = {
  // Bumped up a step from the original hairline-adjacent numbers — edges
  // need to read clearly at a glance even on a dense multi-hundred-box
  // page, not just up close after zooming in. Bumped again slightly per
  // annotator feedback that boxes still read a touch thin.
  // Bumped once more — screenshots at typical working zoom still showed
  // idle/hover edges reading as faint hairlines against busy scan
  // backgrounds, especially where two boxes' edges nearly coincide. A
  // constant shadow (added below, not just on selection) is what actually
  // fixes that: it gives every edge a dark halo so it separates from the
  // page regardless of what color the label happens to be.
  // These are now literal, constant screen-pixel values — every shape that
  // draws with them also sets strokeScaleEnabled={false}, which tells Konva
  // itself (at the moment it actually paints, on every frame) to hold the
  // stroke to this many CSS pixels regardless of the stage's current zoom.
  // That's what makes it immune to the bug this used to have: these numbers
  // were previously divided by the React-state `scale` variable, which is
  // only recomputed once React re-renders — on a page with several hundred
  // annotations, that re-render can lag a frame or more behind the (fully
  // synchronous) `stage.scale()` call that already moved the canvas, so for
  // that gap every edge briefly drew at the OLD scale's compensated size
  // against the NEW zoom level (e.g. a value computed for 0.05x still being
  // used a frame after the stage had already jumped to 1x reads as ~20x too
  // big — exactly the oversized boxes seen when zooming quickly). Konva's
  // own strokeScaleEnabled compensation happens inside its draw call, so
  // there's no React round-trip to lag behind in the first place.
  // Trimmed down a step from the old 3.6/4/4.4 — those read as too heavy
  // once strokeScaleEnabled (below) started holding them to a truly
  // constant screen size at every zoom level; thinner numbers keep edges
  // crisp without looking like thick marker strokes.
  strokeWidth: { normal: 2, hover: 2.4, selected: 2.8 },
  // Idle fills are intentionally light (~10%): a Word almost always sits
  // inside a Line inside a KeyValueContainer inside a GroupedContainer, so
  // every pixel on a densely-annotated page can have 3-4 overlapping boxes
  // stacked on top of each other. At the old, much higher idle alpha,
  // those fills compounded (translucent-over-translucent-over-translucent)
  // until only the topmost box's color was visible at all — exactly the
  // "color of the boxes underneath disappears" bug. Hover/selected stay
  // strong since at most one shape is ever in either state at a time, so
  // there's nothing for them to visually bury.
  // Idle bumped a touch (10% -> 14%) — still light enough that 3-4 stacked
  // containers don't bury each other, but visible enough on its own that a
  // box reads as "filled" rather than "just an outline" at a glance.
  fillAlpha: { normal: "24", hover: "45", selected: "5c" }, // hex alpha suffix (~14% / ~27% / ~36%)
  // Every edge — not just selected — now casts a soft dark halo so its
  // outline separates from the scanned page underneath it instead of
  // blending into busy handwriting/ruling-line backgrounds. Selected stays
  // a stronger blur so the current box still reads as unambiguously "on
  // top" of everything else.
  // IMPORTANT: unlike stroke width or corner radius, Canvas 2D's
  // shadowBlur is explicitly defined as NOT affected by the current
  // transformation matrix (it's already a literal device-pixel value —
  // see the Canvas 2D spec / MDN). This used to be divided by `scale`
  // here on the theory that it needed the same "stay constant on screen"
  // compensation as stroke width — but since the canvas never scales it
  // in the first place, dividing by scale actively broke it: zooming OUT
  // (scale shrinking toward MIN_SCALE = 0.05) inflated this to up to 80,
  // and zooming IN (scale up to MAX_SCALE = 16) shrank it to a fraction of
  // a pixel. That's exactly the "edges look big and ugly, growing on zoom
  // out, shrinking on zoom in" bug — these are now used as plain, literal
  // constants with no scale math at all, so the halo is the same small
  // size on screen at every zoom level.
  shadow: { blur: 2, blurSelected: 4, opacity: 0.35 },
  cornerRadius: 1,
  vertexHandle: { radius: 3, hoverRadius: 4.5, strokeWidth: 1.2, fill: "#ffffff" },
  dashPreview: (scale: number): number[] => [5 / scale, 3.5 / scale],
  // Selection chrome (the Transformer's box + resize handles + rotate
  // "stick"). Brand blue border with a small solid-blue/white-ring handle
  // — a crisp, flat, Figma-style square rather than the old chunky
  // rounded amber "cube" look, which read as oversized/blobby once
  // several handles landed close together (e.g. a small Word box zoomed
  // out, where the 8 anchors' footprints nearly touch). Smaller anchors +
  // a thinner border keep the chrome legible instead of clustering into a
  // solid blob in exactly that case. anchorSize/anchorCornerRadius/
  // anchorStrokeWidth here are also literal constant screen pixels: the
  // Transformer draws its own anchors completely outside the
  // annotations.map() render path below, so those values are kept in
  // sync with the live zoom imperatively (see syncTransformerChrome)
  // instead of via strokeScaleEnabled, but the same "always exactly N px
  // on screen, never dependent on a React re-render landing in time"
  // guarantee applies — including to the rotate handle's connecting
  // "stick", which is drawn using this same borderStroke/borderStrokeWidth
  // pair, so it now scales (and stays thin) in lockstep with everything
  // else instead of drifting out of sync on a fast zoom.
  selection: {
    border: "#2f6fed",
    handle: "#2f6fed",
    borderWidth: 1.75,
    handleStroke: "#ffffff",
    anchorSize: 8,
    anchorCornerRadius: 1,
    anchorStrokeWidth: 1.4,
    rotateAnchorOffset: 16,
  },
  // A Word whose only qualifying WORD COLORS attribute got toggled off
  // isn't fully hidden anymore (see isWordHiddenByColorToggle's own doc
  // comment for why) — it drops its fill and switches to a bare outline
  // in that attribute's own color, thickened up so the outline still
  // reads as clearly "this word has that attribute" even with no fill
  // behind it.
  mutedOutlineWidth: 2.4,
  // A selected Word specifically (the one the transcription popover is
  // open for) always highlights in this color, regardless of its own
  // label/attribute color — a fixed, unambiguous "this is the one you're
  // transcribing right now" signal instead of blending into whatever color
  // that word's label happens to be.
  wordSelected: { stroke: "#7c3aed", fill: "#c4b5fd", fillAlpha: "70" },
} as const;

function withAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

// De-dupes by id, keeping first occurrence — several covered Words can
// walk up to the same existing container (e.g. every Word under one
// Clickable), and that container should only be attached/linked once.
function dedupeById(items: Annotation[]): Annotation[] {
  const seen = new Set<string>();
  return items.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Sorts annotations into reading order — top-to-bottom, then left-to-right
// within a row. Uses each item's axis-aligned bbox (annotationBBox handles
// both BBOX and POLYGON shapes, so a polygon-shaped/handwritten Word is
// still reachable via arrow-key navigation instead of being silently
// skipped). Rows are detected with a tolerance (60% of the median box
// height) rather than an exact y-match, since two words on the "same line"
// of a document are rarely pixel-identical in y.
function readingOrder(items: Annotation[]): Annotation[] {
  if (items.length === 0) return [];
  const boxes = items.map((a) => ({ item: a, box: annotationBBox(a) }));
  const tolerance = Math.max(4, median(boxes.map((b) => b.box.height)) * 0.6);
  const byY = [...boxes].sort((a, b) => a.box.y - b.box.y);
  const rows: Array<typeof boxes> = [];
  for (const entry of byY) {
    const row = rows.find((r) => Math.abs(r[0].box.y - entry.box.y) <= tolerance);
    if (row) row.push(entry);
    else rows.push([entry]);
  }
  rows.sort((a, b) => a[0].box.y - b[0].box.y);
  return rows.flatMap((row) => [...row].sort((a, b) => a.box.x - b.box.x).map((e) => e.item));
}

export function DocumentCanvas({ imageUrl, readOnly = false }: DocumentCanvasProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  // The single source of truth for "what's the stage's scale RIGHT NOW",
  // updated synchronously in the exact same call that touches
  // `stage.scale(...)` (see setLiveScale below) — never dependent on a
  // React commit landing in time. `scale` (state) still exists so the %
  // label and other plain UI text re-render, but every canvas decoration
  // that has to stay a constant screen size regardless of zoom (vertex
  // handles, dashed preview outlines, parent-child link line/dot, the
  // in-progress draw preview) now reads liveScaleRef instead of `scale`
  // directly. Without this, those specific elements (everything BELOW —
  // the Transformer's own chrome already gets this treatment via
  // syncTransformerChrome) could render for one or more frames against
  // whatever `scale` React had last committed, which on a page with
  // hundreds of annotations is not guaranteed to be the same tick as the
  // imperative `stage.scale()` call that just moved the canvas — exactly
  // what reads as "the edges and the stick grow/shrink on zoom" the
  // instant that gap opens, most visibly while zooming out fast (mouse
  // wheel / pinch) since that's the highest-frequency path.
  const liveScaleRef = useRef(1);
  const setLiveScale = useCallback((next: number) => {
    liveScaleRef.current = next;
    setScale(next);
  }, []);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [nearCloseHandle, setNearCloseHandle] = useState(false);
  const [popoverRect, setPopoverRect] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  // Keyboard-driven selection (arrow-key nav) must NOT let the quick-edit
  // popover steal focus into its Transcription input — if it did, the
  // input's autoFocus would swallow the very next Left/Right press as a
  // text-caret move instead of a navigation step (see handleArrowNav),
  // which is what made line-to-line navigation appear to "open the
  // transcription" and get stuck on the last word of a line. A direct
  // canvas click, by contrast, should still autofocus for fast editing.
  const [suppressPopoverAutoFocus, setSuppressPopoverAutoFocus] = useState(false);

  // A freshly-drawn Word keeps the crosshair "bounding" cursor (instead of
  // the normal Select/Move cursor) for as long as it stays selected — i.e.
  // through the whole transcribe-it flow, including the "stays selected
  // after a stray click elsewhere until transcription is filled" carve-out
  // below. It's cleared the moment that Word actually deselects (typed a
  // transcription/checked Skip, then clicked away), which is exactly when
  // the cursor should drop back to normal. Every other label just stays in
  // its draw tool after creating a shape (see handleStageMouseUp /
  // finishPolygon) so this only ever needs to track Word.
  const [pendingWordId, setPendingWordId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const shapeRefs = useRef<Record<string, Konva.Node | null>>({});

  // in-progress draw state — bbox drag or polygon point accumulation
  const [drawRect, setDrawRect] = useState<BBoxGeometry | null>(null);
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);

  const annotations = useAnnotationStore((s) => s.annotations);
  const labelVisibility = useAnnotationStore((s) => s.labelVisibility);
  const wordColorVisibility = useAnnotationStore((s) => s.wordColorVisibility);
  const showParentChildLinks = useAnnotationStore((s) => s.showParentChildLinks);
  const ontology = useAnnotationStore((s) => s.ontology);
  const selectedIds = useAnnotationStore((s) => s.selectedIds);
  const select = useAnnotationStore((s) => s.select);
  const focusToken = useAnnotationStore((s) => s.focusToken);
  const focusRequestId = useAnnotationStore((s) => s.focusRequestId);
  const activeTool = useAnnotationStore((s) => s.activeTool);
  const activeLabelName = useAnnotationStore((s) => s.activeLabelName);
  const createAnnotation = useAnnotationStore((s) => s.createAnnotation);
  const linkChildrenToParent = useAnnotationStore((s) => s.linkChildrenToParent);
  const setActiveTool = useAnnotationStore((s) => s.setActiveTool);
  const createSnappedLine = useAnnotationStore((s) => s.createSnappedLine);
  const updateGeometry = useAnnotationStore((s) => s.updateGeometry);
  const requestDeleteSelected = useAnnotationStore((s) => s.requestDeleteSelected);
  const undo = useAnnotationStore((s) => s.undo);
  const beginUndoableEdit = useAnnotationStore((s) => s.beginUndoableEdit);

  // ---- Measure available space with ResizeObserver so the stage always
  // fills its flex column exactly (fixes stale/incorrect sizing that broke
  // centering whenever the side panels changed width). --------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => setImage(img);
  }, [imageUrl]);

  // Pushes the Transformer's decoration sizes (border, anchors, rotate
  // "stick" offset) straight onto the live Konva node, in the SAME
  // synchronous call as `stage.scale(...)`, instead of leaving them to
  // arrive later as React props.
  //
  // IMPORTANT — verified against Konva's actual runtime behavior: unlike
  // every other shape on this canvas, Konva's Transformer does NOT need
  // (and must NOT get) its chrome sizes divided by the stage's scale.
  // Every other shape here (BBox/Polygon strokes, vertex-handle circles,
  // dash patterns) lives directly inside the zoomed Layer, so its local
  // units get multiplied by the stage scale when painted — those DO need
  // `value / scale` to end up a constant size on screen. The Transformer's
  // anchors/border are different: Konva already renders them independent
  // of the stage's zoom (they're sized for the target node's own,
  // unrelated scale, not the ancestor stage's), so a plain literal pixel
  // value already paints as that many CSS pixels at ANY zoom level.
  //
  // This was measured directly (isolated Konva harness, reading each
  // anchor's real rendered getClientRect()) — with the old `/ liveScale`
  // division, an 8px anchor rendered as ~188px at MIN_SCALE (0.05x, the
  // "zoomed out" balloon this bug report is about) and shrank to well
  // under 1px at MAX_SCALE (16x, the "disappearing on zoom in" half of the
  // same report). Removing the division and passing the literal constants
  // below measured as a rock-solid ~9px at every zoom level from 0.05x to
  // 16x. That confirms the division was the bug, not a missing piece of
  // compensation — the values in SHAPE_STYLE.selection are already exactly
  // what should reach Konva, unmodified.
  const syncTransformerChrome = useCallback((_liveScale: number) => {
    const tr = transformerRef.current;
    if (!tr) return;
    tr.borderStrokeWidth(SHAPE_STYLE.selection.borderWidth);
    tr.anchorSize(SHAPE_STYLE.selection.anchorSize);
    tr.anchorCornerRadius(SHAPE_STYLE.selection.anchorCornerRadius);
    tr.anchorStrokeWidth(SHAPE_STYLE.selection.anchorStrokeWidth);
    tr.rotateAnchorOffset(SHAPE_STYLE.selection.rotateAnchorOffset);
    tr.getLayer()?.batchDraw();
  }, []);

  const fitToScreen = useCallback(
    (animate = false) => {
      const stage = stageRef.current;
      if (!stage || !image || size.width === 0 || size.height === 0) return;
      const pad = 32;
      const fitScale = Math.min(
        (size.width - pad) / image.width,
        (size.height - pad) / image.height,
        MAX_SCALE
      );
      const nextScale = Math.max(fitScale, MIN_SCALE);
      const pos = {
        x: (size.width - image.width * nextScale) / 2,
        y: (size.height - image.height * nextScale) / 2,
      };
      if (animate) {
        // Sync the React-tracked scale to the stage's actual in-progress
        // value on every tween frame — without this, `scale` (which every
        // shape's strokeWidth is computed from, to stay a constant screen
        // width regardless of zoom) jumped straight to the target value
        // while the stage's visual scale was still animating toward it,
        // so every bounding box's stroke visibly thinned/thickened for the
        // whole 180ms of the animation instead of just staying put.
        stage.to({
          x: pos.x,
          y: pos.y,
          scaleX: nextScale,
          scaleY: nextScale,
          duration: 0.18,
          onUpdate: () => {
            syncTransformerChrome(stage.scaleX());
            setLiveScale(stage.scaleX());
          },
        });
      } else {
        stage.position(pos);
        stage.scale({ x: nextScale, y: nextScale });
        syncTransformerChrome(nextScale);
        setLiveScale(nextScale);
      }
    },
    [image, size, syncTransformerChrome]
  );

  // Center + fit whenever the image first loads or the container is resized
  // (e.g. side panels toggling), matching the reference tool's centered
  // document viewport. Kept auto-fitting (not just once) until the user
  // actually pans/zooms/drags for themselves — a single fit-on-first-mount
  // was landing wrong on some jobs where the header wraps to a second row
  // (longer customer id / instructions / task-type text, seen more often
  // opening a QA queue) *after* that first measurement, shrinking the
  // available canvas height without ever re-fitting into it.
  const hasUserAdjustedView = useRef(false);
  useEffect(() => {
    if (!image || size.width === 0 || size.height === 0) return;
    if (hasUserAdjustedView.current) return;
    fitToScreen(false);
    // The very first ResizeObserver callback can land mid-layout — e.g.
    // while the header is still wrapping to its final line count, or a
    // sibling panel hasn't settled its own flex-basis yet (this is
    // exactly what was landing wrong reopening a task after Stop and
    // resume: the header's extra row wasn't accounted for on the very
    // first measurement). Fit once now against whatever size we have,
    // then once more next frame against whatever the *settled* layout
    // turns out to be, rather than trusting the first measurement alone.
    const raf = requestAnimationFrame(() => {
      if (!hasUserAdjustedView.current) fitToScreen(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [image, size, fitToScreen]);

  // readOnly flipping (QA's locked review -> clicking "QA" to unlock the
  // full toolset) swaps in a materially different header/side-panel
  // layout, not just a stray resize — the person may well have already
  // panned/zoomed to inspect the doc while it was still locked, which sets
  // hasUserAdjustedView and would otherwise permanently block the re-fit
  // this new layout needs. Treat any readOnly transition as a fresh start
  // for auto-fit, the same as first opening the document.
  const prevReadOnly = useRef(readOnly);
  useEffect(() => {
    if (prevReadOnly.current !== readOnly) {
      hasUserAdjustedView.current = false;
      prevReadOnly.current = readOnly;
    }
  }, [readOnly]);

  useEffect(() => {
    const nodes = readOnly
      ? []
      : selectedIds
          .map((id) => shapeRefs.current[id])
          .filter((n): n is Konva.Node => !!n && n.getClassName() === "Rect");
    transformerRef.current?.nodes(nodes);
    // A fresh selection attaches the Transformer using whatever chrome
    // sizes React last rendered it with — sync it to the stage's actual
    // current scale right away so a brand-new selection never opens with
    // stale-sized handles either (see syncTransformerChrome above).
    syncTransformerChrome(stageRef.current?.scaleX() ?? scale);
    transformerRef.current?.getLayer()?.batchDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, annotations, readOnly]);

  // ---- Word quick-edit popover: recompute its anchor rect (in
  // container-local pixels — Konva's getClientRect() already bakes in
  // stage pan/zoom) whenever selection, geometry, pan or zoom changes. -----
  const selectedWord: Annotation | null =
    selectedIds.length === 1
      ? annotations.find((a) => a.id === selectedIds[0] && a.labelName === "Word") ?? null
      : null;

  // A Word "needs" its transcription until either some text has been typed
  // in, or the annotator has explicitly checked Skip Transcription — used
  // to keep the quick-edit popover open (and the box selected) instead of
  // letting a stray click elsewhere silently abandon it with nothing filled
  // in.
  function wordNeedsTranscription(a: Annotation | null): boolean {
    if (!a || a.labelName !== "Word") return false;
    if (a.properties.skipTranscription) return false;
    return !a.properties.transcription || a.properties.transcription.trim().length === 0;
  }

  useEffect(() => {
    if (pendingWordId && selectedWord?.id !== pendingWordId) setPendingWordId(null);
  }, [selectedWord?.id, pendingWordId]);

  const updatePopoverRect = useCallback(() => {
    if (!selectedWord) {
      setPopoverRect(null);
      return;
    }
    const node = shapeRefs.current[selectedWord.id];
    if (!node) {
      setPopoverRect(null);
      return;
    }
    const r = node.getClientRect();
    setPopoverRect({ x: r.x, y: r.y, width: r.width, height: r.height });
  }, [selectedWord]);

  useEffect(() => {
    updatePopoverRect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWord?.id, selectedWord?.geometry, scale]);

  function colorFor(labelName: string): string {
    return ontology?.labels.find((l) => l.name === labelName)?.color ?? "#888";
  }

  // Delete selected shape(s) with Delete/Backspace, but never while typing
  // in a *text* field (e.g. the Transcription input in the popover/panel).
  // Bug fix: the previous check blocked on ANY <input> — including
  // checkboxes and <select>s — so once you'd touched "Skip Transcription"
  // or a dropdown in the popover, focus sat on that control and Delete/
  // Backspace silently did nothing, even though you weren't editing text.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const isTextEntry =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "range"].includes(el.type)) ||
        Boolean(el?.isContentEditable);

      // Ctrl+Z (Cmd+Z on Mac) is checked FIRST and deliberately ignores
      // isTextEntry's usual gating below. Annotators spend most of their
      // time with focus sitting in the Transcription input, so gating
      // this the same way Delete/Backspace is gated meant Ctrl+Z silently
      // did nothing (or triggered the browser's own native per-field
      // text-undo instead of ours) at exactly the moment people actually
      // reached for it. Our undo stack already captures transcription
      // edits too (updateProperties calls pushUndo), so there's nothing
      // the native per-field undo would do that ours doesn't already
      // cover — safe to make this a true global shortcut. Deliberately
      // NOT also binding Ctrl+Shift+Z/Ctrl+Y as redo — only undo was
      // asked for, and there's no redo stack backing it yet.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!readOnly) undo();
        return;
      }

      if (isTextEntry) return;
      if (readOnly) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        requestDeleteSelected();
      }
      if (e.key === "Escape") {
        drawStart.current = null;
        setDrawRect(null);
        setPolygonPoints([]);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [requestDeleteSelected, readOnly, undo]);

  // ---- Left/Right arrow navigation between bounding boxes ---------------
  // Which shapes are reachable depends on which of Word/Line are currently
  // toggled visible in the left panel:
  //  - only Word visible  -> cycles word to word
  //  - only Line visible  -> cycles line to line
  //  - both visible       -> each Line, then the Words nested inside it
  //    (via lineParentId), before moving on to the next Line — so arrowing
  //    right walks into a line's words before advancing past it
  // Words that aren't grouped under any Line are still included (as their
  // own single-item stop) so they stay reachable even when Lines are shown.
  const navOrder = useMemo(() => {
    const lineVisible = labelVisibility["Line"]?.visible ?? true;
    const wordVisible = labelVisibility["Word"]?.visible ?? true;
    if (!lineVisible && !wordVisible) return [] as Annotation[];

    // A word hidden by a WORD COLORS toggle (see isWordHiddenByColorToggle)
    // isn't drawn at all, so arrow-key nav shouldn't be able to land on it
    // either — that would select an invisible shape with nothing on
    // screen to show for it.
    const navAnnotations = annotations.filter(
      (a) => a.labelName !== "Word" || !isWordHiddenByColorToggle(a.properties, wordColorVisibility)
    );

    if (lineVisible && !wordVisible) {
      return readingOrder(navAnnotations.filter((a) => a.labelName === "Line"));
    }
    if (wordVisible && !lineVisible) {
      return readingOrder(navAnnotations.filter((a) => a.labelName === "Word"));
    }

    const lines = readingOrder(navAnnotations.filter((a) => a.labelName === "Line"));
    const orphanWords = navAnnotations.filter((a) => a.labelName === "Word" && !a.lineParentId);
    const groups = [
      ...lines.map((line) => ({
        anchor: line,
        items: [
          line,
          ...readingOrder(navAnnotations.filter((a) => a.labelName === "Word" && a.lineParentId === line.id)),
        ],
      })),
      ...orphanWords.map((w) => ({ anchor: w, items: [w] })),
    ];
    // Order the groups themselves in reading order (using each group's
    // anchor shape — the Line's own box, or the orphan word's box), then
    // flatten each group's [line, ...words] (or [word]) in sequence.
    return readingOrder(groups.map((g) => g.anchor)).flatMap(
      (anchor) => groups.find((g) => g.anchor === anchor)!.items
    );
  }, [annotations, labelVisibility, wordColorVisibility]);

  // Re-centers the stage (pan only, zoom untouched) on a shape's midpoint —
  // keeps the newly-selected box on screen when arrow-key navigation jumps
  // to a shape outside the current viewport.
  function centerOn(a: Annotation) {
    const stage = stageRef.current;
    if (!stage) return;
    const g = annotationBBox(a);
    const s = stage.scaleX();
    stage.position({
      x: size.width / 2 - (g.x + g.width / 2) * s,
      y: size.height / 2 - (g.y + g.height / 2) * s,
    });
    stage.batchDraw();
    requestAnimationFrame(updatePopoverRect);
  }

  // A validation issue clicked in the right panel calls focusAnnotation()
  // instead of plain select() specifically so it bumps focusToken — that's
  // what lets this fire even when the flagged shape is already selected,
  // panning/centering it into view the same way arrow-key nav does.
  useEffect(() => {
    if (!focusRequestId || focusToken === 0) return;
    setSuppressPopoverAutoFocus(true);
    const target = annotations.find((a) => a.id === focusRequestId);
    if (target) centerOn(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  useEffect(() => {
    function handleArrowNav(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement as HTMLElement | null;
      const isTextEntry =
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "range"].includes(el.type)) ||
        Boolean(el?.isContentEditable);
      if (isTextEntry || navOrder.length === 0) return;

      e.preventDefault();
      const currentIndex = selectedIds.length === 1 ? navOrder.findIndex((a) => a.id === selectedIds[0]) : -1;
      const nextIndex =
        currentIndex === -1
          ? e.key === "ArrowRight"
            ? 0
            : navOrder.length - 1
          : (currentIndex + (e.key === "ArrowRight" ? 1 : -1) + navOrder.length) % navOrder.length;

      const next = navOrder[nextIndex];
      setSuppressPopoverAutoFocus(true);
      select(next.id);
      centerOn(next);
    }
    window.addEventListener("keydown", handleArrowNav);
    return () => window.removeEventListener("keydown", handleArrowNav);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navOrder, selectedIds, select, size]);

  function pointerPos(): { x: number; y: number } | null {
    const stage = stageRef.current;
    return stage?.getRelativePointerPosition() ?? null;
  }

  function zoomAtPoint(nextScaleRaw: number, point: { x: number; y: number }) {
    const stage = stageRef.current;
    if (!stage) return;
    hasUserAdjustedView.current = true;
    const nextScale = Math.min(Math.max(nextScaleRaw, MIN_SCALE), MAX_SCALE);
    const oldScale = stage.scaleX();
    const mousePointTo = {
      x: (point.x - stage.x()) / oldScale,
      y: (point.y - stage.y()) / oldScale,
    };
    stage.scale({ x: nextScale, y: nextScale });
    stage.position({
      x: point.x - mousePointTo.x * nextScale,
      y: point.y - mousePointTo.y * nextScale,
    });
    syncTransformerChrome(nextScale);
    setLiveScale(nextScale);
    requestAnimationFrame(updatePopoverRect);
  }

  // Matches the reference tool's shortcut sheet: plain scroll pans the
  // document (trackpad two-finger swipe pans both axes via deltaX/deltaY),
  // Shift+scroll forces horizontal panning, and Ctrl/Cmd+scroll (also how
  // browsers report trackpad pinch-zoom) zooms to the cursor.
  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    hasUserAdjustedView.current = true;

    const { ctrlKey, metaKey, shiftKey, deltaX, deltaY } = e.evt;

    if (ctrlKey || metaKey) {
      const scaleBy = 1.06;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const nextScale = deltaY < 0 ? stage.scaleX() * scaleBy : stage.scaleX() / scaleBy;
      zoomAtPoint(nextScale, pointer);
      return;
    }

    const dx = shiftKey ? deltaY : deltaX;
    const dy = shiftKey ? 0 : deltaY;
    stage.position({ x: stage.x() - dx, y: stage.y() - dy });
    stage.batchDraw();
    requestAnimationFrame(updatePopoverRect);
  }

  // Reads the LIVE stage scale (never the possibly-one-render-behind
  // `scale` state) as the base for the next zoom step — clicking these
  // buttons in quick succession before React has committed the previous
  // click's state update used to base every click on the same stale
  // starting value, which could leave the applied stage scale and the
  // displayed %/handle sizing out of step with each other. Konva's own
  // `stage.scaleX()` is always current the instant it's read, imperative
  // and synchronous, so this can never lag.
  function currentLiveScale(): number {
    return stageRef.current?.scaleX() ?? liveScaleRef.current ?? scale;
  }

  function zoomButton(factor: number) {
    zoomAtPoint(currentLiveScale() * factor, { x: size.width / 2, y: size.height / 2 });
  }

  function stepZoom(deltaSteps: number) {
    const currentStep = Math.max(1, Math.round(currentLiveScale()));
    const nextStep = Math.min(Math.max(currentStep + deltaSteps, 1), Math.round(MAX_SCALE));
    zoomAtPoint(nextStep, { x: size.width / 2, y: size.height / 2 });
  }

  function resetZoom() {
    zoomAtPoint(1, { x: size.width / 2, y: size.height / 2 });
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    // Bug fix: the document image sits between the stage background and
    // every shape, so a click that lands on visible page content (which is
    // most of the canvas) hit the Image node, not the Stage — clickedEmpty
    // was false there, so selection (and the Transformer's resize handles)
    // never cleared. Treat clicks on either as "empty".
    const targetClass = e.target.getClassName?.();
    const clickedEmpty = e.target === e.target.getStage() || targetClass === "Image";

    if (readOnly) {
      if (clickedEmpty) setIsPanning(true);
      return;
    }

    if (activeTool === "bbox" && activeLabelName) {
      const pos = pointerPos();
      if (!pos) return;
      drawStart.current = pos;
      setDrawRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
      return;
    }

    if (activeTool === "polygon" && activeLabelName) {
      const pos = pointerPos();
      if (!pos) return;

      // Bug fix: clicking back on (or very near) the first vertex should
      // close the polygon, not add a near-duplicate point on top of it.
      if (polygonPoints.length >= 3) {
        const [fx, fy] = polygonPoints[0];
        const dist = Math.hypot(pos.x - fx, pos.y - fy) * scale;
        if (dist <= CLOSE_THRESHOLD_PX) {
          finishPolygon();
          return;
        }
      }

      setPolygonPoints((pts) => [...pts, [pos.x, pos.y]]);
      return;
    }

    if (clickedEmpty) {
      // A freshly-bound Word with no transcription yet (and not marked
      // "skip") stays selected — and its popover stays open — even when
      // the user clicks off onto empty canvas. Without this, a stray click
      // while reaching for the transcription field silently dropped back
      // to the plain cursor and lost the box's context. Once a
      // transcription (or an explicit skip) is in place, clicking
      // elsewhere deselects normally.
      if (wordNeedsTranscription(selectedWord)) {
        // The box itself staying selected is intentional (see above) —
        // but the cursor shouldn't keep reading as "hovering an active
        // shape" once the pointer has actually left it and is sitting
        // over empty canvas. Only Word gets this "stay selected" carve-out
        // at all, so this reset is scoped to exactly that case; every
        // other label's away-click still runs the normal select(null)
        // path below, cursor included.
        setHoveredId(null);
        return;
      }
      select(null);
      setIsPanning(true);
    }
  }

  function handleStageMouseMove() {
    if (readOnly) return;
    if (activeTool === "bbox" && drawStart.current) {
      const pos = pointerPos();
      if (!pos) return;
      const { x: sx, y: sy } = drawStart.current;
      setDrawRect({
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        width: Math.abs(pos.x - sx),
        height: Math.abs(pos.y - sy),
      });
      return;
    }

    if (activeTool === "polygon" && polygonPoints.length >= 3) {
      const pos = pointerPos();
      if (!pos) return;
      const [fx, fy] = polygonPoints[0];
      const dist = Math.hypot(pos.x - fx, pos.y - fy) * scale;
      setNearCloseHandle(dist <= CLOSE_THRESHOLD_PX);
    }
  }

  // A Word counts as "under" the drawn box if the box covers most of the
  // word's own area — more forgiving than requiring the whole word inside,
  // since a quick drag rarely lands pixel-perfect on every word's edges.
  // Polygon-shaped Words (e.g. irregular handwritten-cursive shapes) are
  // included via their axis-aligned bbox — excluding them was the actual
  // bug behind "snapping doesn't work on handwritten words."
  // Centroid of a shape regardless of geometry kind — a bbox's center, or
  // the average of a polygon's points. Shared by the parent-child link
  // lines/dots and the "highlight this parent's children" dots below.
  function shapeCenter(g: BBoxGeometry | PolygonGeometry): [number, number] {
    if ("width" in g) return [g.x + g.width / 2, g.y + g.height / 2];
    return [
      g.points.reduce((sum, p) => sum + p[0], 0) / g.points.length,
      g.points.reduce((sum, p) => sum + p[1], 0) / g.points.length,
    ];
  }

  function wordsCoveredBy(rect: BBoxGeometry): Annotation[] {
    return annotations.filter((a) => {
      if (a.labelName !== "Word") return false;
      const g = annotationBBox(a);
      const ix = Math.max(0, Math.min(rect.x + rect.width, g.x + g.width) - Math.max(rect.x, g.x));
      const iy = Math.max(0, Math.min(rect.y + rect.height, g.y + g.height) - Math.max(rect.y, g.y));
      const overlapArea = ix * iy;
      const wordArea = g.width * g.height;
      return wordArea > 0 && overlapArea / wordArea > 0.5;
    });
  }

  // Same >50%-overlap test as wordsCoveredBy, but for existing CONTAINERS
  // (Key/SubKey/Value/SubValue/Clickable-true-or-false/KeyValueContainer)
  // directly under the drawn box — not just Words. This is what makes an
  // EMPTY Clickable (no Word annotated inside it, e.g. an unchecked box
  // with nothing written) still get picked up: wordsCoveredBy alone finds
  // nothing to walk up from when there's no Word at all, so a Value drawn
  // over an empty ClickableItemFalse used to fall through to the "just
  // keep my rough drag" branch below and never adjust to that Clickable's
  // edges, or link it as a child, even though a non-empty one already
  // worked via immediateCoveredChild.
  function containersCoveredBy(rect: BBoxGeometry, candidateLabels: string[]): Annotation[] {
    return annotations.filter((a) => {
      if (!candidateLabels.includes(a.labelName)) return false;
      const g = annotationBBox(a);
      const ix = Math.max(0, Math.min(rect.x + rect.width, g.x + g.width) - Math.max(rect.x, g.x));
      const iy = Math.max(0, Math.min(rect.y + rect.height, g.y + g.height) - Math.max(rect.y, g.y));
      const overlapArea = ix * iy;
      const area = g.width * g.height;
      return area > 0 && overlapArea / area > 0.5;
    });
  }

  // Everything a new container box drawn over `rect` should attach to and
  // grow to enclose: each covered Word walks up to its nearest existing
  // container below this new label's own rank (immediateCoveredChild),
  // UNION'd with any existing container of an eligible rank that's
  // directly covered but has no Word inside it at all (containersCoveredBy
  // — the empty-Clickable case above). De-duped so a container reached
  // both ways (has Words AND is directly covered) is only attached once.
  function attachTargetsFor(rect: BBoxGeometry, labelName: string): Annotation[] {
    const newRank = KV_LABEL_RANK[labelName] ?? 99;
    const candidateLabels = Object.keys(KV_LABEL_RANK).filter(
      (l) => KV_LABEL_RANK[l] > 0 && KV_LABEL_RANK[l] < newRank
    );
    const words = wordsCoveredBy(rect);
    return dedupeById([
      ...words.map((w) => immediateCoveredChild(w, annotations, newRank)),
      ...containersCoveredBy(rect, candidateLabels),
    ]);
  }

  function handleStageMouseUp() {
    setIsPanning(false);
    if (readOnly) return;
    if (activeTool === "bbox" && drawStart.current && drawRect && activeLabelName) {
      let newId: string | null = null;
      if (drawRect.width > 3 && drawRect.height > 3) {
        if (activeLabelName === "Line") {
          // Drawing a Line over some Words snaps it to their exact union
          // and links them, instead of keeping whatever rough box the user
          // dragged — mirrors "Group into Line" but from the canvas.
          const words = wordsCoveredBy(drawRect);
          if (words.length > 0) newId = createSnappedLine(words);
          else newId = createAnnotation(activeLabelName, "BBOX", drawRect);
        } else {
          // Same snap-to-what's-underneath behavior applies to every other
          // label, not just Line: whatever box gets drawn on top of
          // existing content adjusts to fully enclose it, rather than
          // keeping the user's rough drag. See attachTargetsFor's own
          // comment above — this now also picks up an EMPTY Clickable
          // (nothing written in it yet) directly under the box, not just
          // ones that already have a Word. Links them the same way Line
          // does via lineParentId, just through parentAnnotationId instead
          // — this used to stop at the visual snap and never actually
          // link anything as a child, meaning a Value/Key box drawn
          // directly over its content LOOKED right but the KV tree (and
          // anything built from it, like the PDF report) still saw it as
          // empty.
          const attachTargets = attachTargetsFor(drawRect, activeLabelName);
          if (attachTargets.length > 0) {
            newId = createAnnotation(activeLabelName, "BBOX", boundingBoxOf(attachTargets.map(annotationBBox)));
            linkChildrenToParent(
              attachTargets.map((t) => t.id),
              newId
            );
          } else {
            newId = createAnnotation(activeLabelName, "BBOX", drawRect);
          }
        }
      }
      // Whether a real box got drawn above, or this was just a tap too
      // small to count as a drag (drawRect.width/height <= 3), the draw
      // tool stays active — the crosshair cursor and "click starts
      // another box" behavior now persist so the next box (same label)
      // can be drawn immediately without reselecting the label from the
      // panel. Word is the one exception: it drops into Select/Move so
      // the freshly-drawn box can be dragged/resized and its
      // transcription popover interacted with; pendingWordId keeps the
      // crosshair showing anyway until that Word is actually deselected
      // (see the cursor calculation below).
      if (activeLabelName === "Word") {
        setActiveTool("select");
        if (newId) setPendingWordId(newId);
      }
      drawStart.current = null;
      setDrawRect(null);
    }
  }

  function handleStageDragMove() {
    updatePopoverRect();
  }

  function finishPolygon() {
    if (readOnly) return;
    if (activeTool === "polygon" && activeLabelName && polygonPoints.length >= 3) {
      // Same "snap to what's underneath" idea as the bbox tool's
      // attachTargetsFor + boundingBoxOf (drawing a box over existing
      // content adjusts to its exact union rather than the user's rough
      // drag) — but via convex hull instead of an axis-aligned union, so a
      // polygon drawn over an irregular polygon-shaped Word (e.g. a
      // handwritten cursive shape) hugs its actual outline instead of
      // ballooning out to that Word's rectangular bbox.
      const xs = polygonPoints.map((p) => p[0]);
      const ys = polygonPoints.map((p) => p[1]);
      const drawnBBox: BBoxGeometry = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
      const attachTargets = attachTargetsFor(drawnBBox, activeLabelName);
      const geometry: PolygonGeometry =
        attachTargets.length > 0
          ? { points: convexHull(attachTargets.flatMap(annotationOutlinePoints)) }
          : { points: polygonPoints };
      const newId = createAnnotation(activeLabelName, "POLYGON", geometry);
      // Same parent-linking fix as the bbox path above — a polygon drawn
      // over existing content needs to actually claim it as children, not
      // just visually snap around them.
      if (attachTargets.length > 0) {
        linkChildrenToParent(
          attachTargets.map((t) => t.id),
          newId
        );
      }
      // Same "stay in the draw tool" behavior as the bbox tool — see the
      // matching comment in handleStageMouseUp. Word is the one exception:
      // it drops into Select/Move for the popover, with pendingWordId
      // keeping the crosshair cursor showing until it's actually
      // deselected.
      if (activeLabelName === "Word") {
        setActiveTool("select");
        setPendingWordId(newId);
      }
    }
    setPolygonPoints([]);
    setNearCloseHandle(false);
  }

  // Drawing tools always get the crosshair "+"; the select tool shows an
  // open hand over empty canvas, a closed hand while actively panning, and
  // a move cursor while hovering a draggable shape. A just-drawn Word is
  // the one carve-out: even though it drops into "select" (so its box can
  // be dragged/resized and its popover used), the crosshair stays put for
  // as long as pendingWordId is still that same Word — i.e. all the way
  // through transcribing it — and only clears once it's actually
  // deselected (see the pendingWordId effect above).
  const cursor =
    activeTool === "bbox" || activeTool === "polygon" || (pendingWordId && selectedWord?.id === pendingWordId)
      ? "crosshair"
      : isPanning
      ? "grabbing"
      : hoveredId && !readOnly
      ? "move"
      : "grab";

  // The freshest possible scale to feed into every "hold this constant on
  // screen" computation below (dash patterns, vertex-handle radii, the
  // parent-child link dot) — reads the live ref (kept in perfect sync with
  // `stage.scale()` the instant it changes, see setLiveScale above) rather
  // than the `scale` state directly, so none of these can ever paint one
  // render behind an in-flight zoom. Falls back to `scale` only for the
  // very first paint before the ref has been initialized from a real
  // stage measurement.
  const liveScale = liveScaleRef.current || scale;

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minWidth: 0, overflow: "hidden", background: "#333", position: "relative", cursor }}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={activeTool === "select"}
          onDragStart={() => {
            hasUserAdjustedView.current = true;
            setIsPanning(true);
          }}
          onDragMove={handleStageDragMove}
          onDragEnd={() => setIsPanning(false)}
          onWheel={handleWheel}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
          onMouseUp={handleStageMouseUp}
          onDblClick={finishPolygon}
        >
          <Layer>
            {image && <KonvaImage image={image} />}

            {annotations.map((a) => {
              const visible = labelVisibility[a.labelName]?.visible ?? true;
              if (!visible) return null;
              // A WORD COLORS toggle switched off no longer hides the
              // word's whole box — it drops to a bare, vividly-colored
              // outline in that attribute's own color instead (still using
              // the attribute's color, not the plain Word color, so it's
              // obvious *which* attribute is present even while muted) —
              // see isWordHiddenByColorToggle's doc comment for exactly
              // when this applies (only when every qualifying attribute on
              // this word is currently toggled off).
              const isMuted =
                a.labelName === "Word" && isWordHiddenByColorToggle(a.properties, wordColorVisibility);
              // A skipped/flagged Word takes the highest-priority visible
              // legend color (Sec. "WORD COLORS" — skip_transcription reads
              // as a light transparent orange) instead of its plain label
              // color, so annotators can spot flagged words at a glance.
              // Muted words still use their (now-hidden) attribute color
              // for the outline — wordColorFor(props, {}) treats every
              // rule as visible, so it returns that natural color back.
              const overlay =
                a.labelName === "Word"
                  ? wordColorFor(a.properties, isMuted ? {} : wordColorVisibility)
                  : null;
              const color = overlay ?? colorFor(a.labelName);
              const isSelected = selectedIds.includes(a.id);
              // The pale-blue selected treatment applies to Word only —
              // every other label keeps using its own color when selected.
              const isSelectedWord = isSelected && a.labelName === "Word";
              const effectiveColor = isSelectedWord ? SHAPE_STYLE.wordSelected.stroke : color;
              const isHovered = hoveredId === a.id;
              const locked = labelVisibility[a.labelName]?.locked ?? false;

              const handleSelect = (e: Konva.KonvaEventObject<MouseEvent>) => {
                if (activeTool !== "select") return; // drawing takes priority
                setSuppressPopoverAutoFocus(false);
                select(a.id, e.evt.shiftKey);
              };
              const handleHoverIn = () => activeTool === "select" && !locked && setHoveredId(a.id);
              const handleHoverOut = () => setHoveredId((id) => (id === a.id ? null : id));

              if (a.shapeType === "BBOX") {
                const geo = a.geometry as BBoxGeometry;
                return (
                  <Rect
                    key={a.id}
                    ref={(node) => (shapeRefs.current[a.id] = node)}
                    // Positioned/offset so x,y is the box's CENTER and
                    // rotation happens in place around it — rotating
                    // around the default top-left corner would make the
                    // box swing wildly instead of tilting where it sits.
                    x={geo.x + geo.width / 2}
                    y={geo.y + geo.height / 2}
                    offsetX={geo.width / 2}
                    offsetY={geo.height / 2}
                    width={geo.width}
                    height={geo.height}
                    rotation={geo.rotation ?? 0}
                    // Unlike the Transformer's chrome (see the long
                    // comment above syncTransformerChrome), this Rect
                    // lives directly inside the zoomed Layer like every
                    // other annotation shape, so its cornerRadius (a
                    // geometric property, not a stroke) DOES need the
                    // `/ liveScale` compensation to stay a constant
                    // visual rounding at any zoom instead of vanishing
                    // when zoomed out or ballooning when zoomed in.
                    cornerRadius={SHAPE_STYLE.cornerRadius / liveScale}
                    stroke={effectiveColor}
                    // strokeScaleEnabled={false} tells Konva to hold this
                    // shape's stroke to a literal, constant screen-pixel
                    // width no matter what the stage's current zoom is —
                    // computed inside Konva's own draw call, so (unlike the
                    // old `/ scale` math, which needed a React re-render to
                    // pick up each new zoom level) it can never lag behind
                    // a fast zoom gesture. See the SHAPE_STYLE.strokeWidth
                    // comment above for the full "why".
                    strokeScaleEnabled={false}
                    strokeWidth={
                      isMuted
                        ? SHAPE_STYLE.mutedOutlineWidth
                        : isSelected
                          ? SHAPE_STYLE.strokeWidth.selected
                          : isHovered
                            ? SHAPE_STYLE.strokeWidth.hover
                            : SHAPE_STYLE.strokeWidth.normal
                    }
                    fill={isMuted ? undefined : isSelectedWord ? withAlpha(SHAPE_STYLE.wordSelected.fill, SHAPE_STYLE.wordSelected.fillAlpha) : withAlpha(
                      color,
                      isSelected ? SHAPE_STYLE.fillAlpha.selected : isHovered ? SHAPE_STYLE.fillAlpha.hover : SHAPE_STYLE.fillAlpha.normal
                    )}
                    shadowColor={effectiveColor}
                    // Literal constant — see the SHAPE_STYLE.shadow comment
                    // above for why this must NOT be divided by scale.
                    shadowBlur={isSelected ? SHAPE_STYLE.shadow.blurSelected : SHAPE_STYLE.shadow.blur}
                    shadowOpacity={SHAPE_STYLE.shadow.opacity}
                    draggable={activeTool === "select" && !locked && !readOnly}
                    onClick={handleSelect}
                    onTap={handleSelect}
                    onMouseEnter={handleHoverIn}
                    onMouseLeave={handleHoverOut}
                    onDragStart={(e) => {
                      e.cancelBubble = true;
                      if (!readOnly) beginUndoableEdit();
                    }}
                    onDragMove={() => requestAnimationFrame(updatePopoverRect)}
                    onDragEnd={(e) => {
                      e.cancelBubble = true;
                      if (readOnly) return;
                      // node.x()/y() is the CENTER (see offsetX/Y above) —
                      // convert back to the stored top-left, independent
                      // of any existing rotation (translation and
                      // rotation are orthogonal here).
                      updateGeometry(a.id, {
                        ...geo,
                        x: e.target.x() - geo.width / 2,
                        y: e.target.y() - geo.height / 2,
                      });
                    }}
                    onTransformStart={() => {
                      if (!readOnly) beginUndoableEdit();
                    }}
                    onTransformEnd={(e) => {
                      if (readOnly) return;
                      const node = e.target as Konva.Rect;
                      const newWidth = node.width() * node.scaleX();
                      const newHeight = node.height() * node.scaleY();
                      updateGeometry(a.id, {
                        x: node.x() - newWidth / 2,
                        y: node.y() - newHeight / 2,
                        width: newWidth,
                        height: newHeight,
                        rotation: node.rotation(),
                      });
                      node.scaleX(1);
                      node.scaleY(1);
                    }}
                  />
                );
              }

              const geo = a.geometry as PolygonGeometry;
              return (
                <PolygonShape
                  key={a.id}
                  annotationId={a.id}
                  geo={geo}
                  color={effectiveColor}
                  fillOverrideColor={isSelectedWord ? SHAPE_STYLE.wordSelected.fill : undefined}
                  fillOverrideAlpha={isSelectedWord ? SHAPE_STYLE.wordSelected.fillAlpha : undefined}
                  isSelected={isSelected}
                  isHovered={isHovered}
                  locked={locked}
                  readOnly={readOnly}
                  activeTool={activeTool}
                  scale={liveScale}
                  registerRef={(node) => (shapeRefs.current[a.id] = node)}
                  onSelect={handleSelect}
                  onHoverIn={handleHoverIn}
                  onHoverOut={handleHoverOut}
                  onUpdate={(next) => updateGeometry(a.id, next)}
                  onBeginEdit={beginUndoableEdit}
                />
              );
            })}

            {/* Sec. 2.5 "Show Parent - Child Links": clicking a Line (or a
                KV-tree parent) while this is on draws one dashed line from
                the parent's center to each of ITS OWN direct children's
                centers, with one solid dot per child — so a parent with 2
                children shows exactly 2 dots, not 3. (Bug fix: this used
                to also drop a dot at the *parent's* own center once per
                child — invisible as an extra dot when there was only one
                child, since it landed exactly on top of the single
                per-child dot, but an actual visible 3rd dot the moment a
                parent had 2+ children, e.g. 2 Words under 1 Line drawing
                as "3 dots for 2 boundings".) No dot is drawn at the parent
                itself — the parent already has its own selection outline,
                so a dot there would just be double marking it.

                Only drawn for a currently-SELECTED parent — clicking a
                Line (or a KV-tree parent) shows its own links, but
                clicking one of the child Words underneath it must not
                light up every relationship in the document. Uses each
                shape's true centroid (not just a bbox center) so a
                polygon-shaped Word/Line links from the right point instead
                of being skipped entirely. Drawn AFTER (so: on top of)
                every shape above, not before — otherwise every box's own
                fill sits on top of the link line and silently paints over
                it, "on" in the data/toggle sense but invisible on
                screen. */}
            {showParentChildLinks &&
              selectedIds.flatMap((parentId) => {
                const parent = annotations.find((a) => a.id === parentId);
                if (!parent) return [];
                const children = annotations.filter(
                  (a) => a.lineParentId === parentId || a.parentAnnotationId === parentId
                );
                if (children.length === 0) return [];
                const [px, py] = shapeCenter(parent.geometry as BBoxGeometry | PolygonGeometry);
                const dotRadius = 5.5 / liveScale;
                return children.flatMap((child) => {
                  const [cx, cy] = shapeCenter(child.geometry as BBoxGeometry | PolygonGeometry);
                  return [
                    <Line
                      key={`link-${parentId}-${child.id}`}
                      points={[px, py, cx, cy]}
                      stroke="#f59e0b"
                      strokeScaleEnabled={false}
                      strokeWidth={2.4}
                      dash={[7 / liveScale, 5 / liveScale]}
                      opacity={0.95}
                      listening={false}
                    />,
                    <Circle
                      key={`link-dot-${parentId}-${child.id}`}
                      x={cx}
                      y={cy}
                      radius={dotRadius}
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeScaleEnabled={false}
                      strokeWidth={1.4}
                      shadowColor="#000"
                      shadowBlur={2}
                      shadowOpacity={0.3}
                      listening={false}
                    />,
                  ];
                });
              })}

            {/* live preview while drawing a new bbox — strokeScaleEnabled
                + a literal constant width, exactly like every finished
                shape below, so the in-progress outline doesn't visibly
                read as a different thickness than the box it turns into
                the instant the mouse comes up. This used to be the one
                remaining `/scale`-divided stroke on the whole canvas —
                everything else already switched over (see the SHAPE_STYLE
                comment above), so a box drawn while zoomed out looked
                thin while dragging and then "jumped" thicker on release. */}
            {drawRect && activeLabelName && (
              <Rect
                x={drawRect.x}
                y={drawRect.y}
                width={drawRect.width}
                height={drawRect.height}
                cornerRadius={SHAPE_STYLE.cornerRadius / liveScale}
                stroke={colorFor(activeLabelName)}
                fill={withAlpha(colorFor(activeLabelName), SHAPE_STYLE.fillAlpha.normal)}
                dash={SHAPE_STYLE.dashPreview(liveScale)}
                strokeScaleEnabled={false}
                strokeWidth={SHAPE_STYLE.strokeWidth.selected}
              />
            )}

            {/* live preview while accumulating polygon points, with a dot
                at every placed vertex. The first vertex grows and turns
                accent-colored once you're close enough to click-to-close. */}
            {polygonPoints.length > 0 && activeLabelName && (
              <>
                <Line
                  points={polygonPoints.flat()}
                  stroke={colorFor(activeLabelName)}
                  strokeScaleEnabled={false}
                  strokeWidth={SHAPE_STYLE.strokeWidth.selected}
                  dash={SHAPE_STYLE.dashPreview(liveScale)}
                  closed={nearCloseHandle}
                  fill={nearCloseHandle ? withAlpha(colorFor(activeLabelName), SHAPE_STYLE.fillAlpha.hover) : undefined}
                />
                {polygonPoints.map(([x, y], i) => {
                  const isFirst = i === 0;
                  const highlight = isFirst && nearCloseHandle;
                  return (
                    <Circle
                      key={i}
                      x={x}
                      y={y}
                      radius={(highlight ? SHAPE_STYLE.vertexHandle.hoverRadius : SHAPE_STYLE.vertexHandle.radius) / liveScale}
                      fill={highlight ? "var(--color-accent)" : SHAPE_STYLE.vertexHandle.fill}
                      stroke={colorFor(activeLabelName)}
                      strokeScaleEnabled={false}
                      strokeWidth={SHAPE_STYLE.vertexHandle.strokeWidth}
                    />
                  );
                })}
              </>
            )}

            <Transformer
              ref={transformerRef}
              rotateEnabled
              // The "stick" sticking up from top-center that the user
              // drags to rotate — default Konva behavior, just called out
              // here since it's the whole point of turning rotation on.
              // 16 gives a clearly visible gap from the top-center resize
              // handle (still well short of Konva's default ~50, which
              // towers over small boxes).
              //
              // These are literal, constant CSS-pixel values with NO
              // `/ liveScale` division — see the long comment on
              // syncTransformerChrome above for why: Konva's Transformer
              // already renders its own chrome independent of the stage's
              // zoom, so dividing by scale here was the actual cause of
              // the "balloons on zoom out, disappears on zoom in" bug
              // (measured directly: with the division, an 8px anchor
              // rendered as ~188px at 0.05x zoom and under 1px at 16x
              // zoom; as a plain constant it holds ~9px at every zoom
              // level). These four props (and rotateAnchorOffset) only
              // supply the size for the very FIRST paint of a selection —
              // syncTransformerChrome (see above) is what keeps them in
              // sync afterward, imperatively and in the same tick as
              // `stage.scale()`, so there's never a React-render-timing
              // gap for these to visibly lag through.
              rotateAnchorOffset={SHAPE_STYLE.selection.rotateAnchorOffset}
              rotationSnaps={[0, 90, 180, 270]}
              rotationSnapTolerance={5}
              anchorSize={SHAPE_STYLE.selection.anchorSize}
              anchorCornerRadius={SHAPE_STYLE.selection.anchorCornerRadius}
              anchorStroke={SHAPE_STYLE.selection.handleStroke}
              anchorFill={SHAPE_STYLE.selection.handle}
              anchorStrokeWidth={SHAPE_STYLE.selection.anchorStrokeWidth}
              borderStroke={SHAPE_STYLE.selection.border}
              borderStrokeWidth={SHAPE_STYLE.selection.borderWidth}
              ignoreStroke
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 4 || newBox.height < 4 ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      )}

      {!readOnly && selectedWord && popoverRect && (
        <WordQuickEditPopover
          annotation={selectedWord}
          anchorRect={popoverRect}
          containerSize={size}
          autoFocusInput={!suppressPopoverAutoFocus}
          onClose={() => select(null)}
        />
      )}

      {activeTool === "polygon" && polygonPoints.length > 0 && (
        <div style={{ ...hudStyle, bottom: "auto", top: 12, left: 12 }}>
          {nearCloseHandle
            ? "Click to close the polygon"
            : `${polygonPoints.length} points — click the first dot or double-click to close`}
        </div>
      )}

      {/* Document zoom / fit controls — two-row widget matching the
          reference tool's bottom-left zoom cluster. */}
      <div style={zoomWidgetStyle}>
        <div style={zoomRowStyle}>
          <IconBtn title="Fit to screen" onClick={() => fitToScreen(true)}>
            <FitScreenIcon />
          </IconBtn>
          <IconBtn title="Zoom step down" onClick={() => stepZoom(-1)}>
            <MinusIcon />
          </IconBtn>
          <span style={zoomStepLabelStyle}>{Math.max(1, Math.round(scale))}x</span>
          <IconBtn title="Zoom step up" onClick={() => stepZoom(1)}>
            <PlusIcon />
          </IconBtn>
        </div>
        <div style={zoomRowStyle}>
          <IconBtn title="Zoom out" onClick={() => zoomButton(1 / 1.25)}>
            <MinusIcon />
          </IconBtn>
          <button onClick={resetZoom} title="Reset to 100%" style={zoomPctStyle}>
            {Math.round(scale * 100)}%
          </button>
          <IconBtn title="Zoom in" onClick={() => zoomButton(1.25)}>
            <PlusIcon />
          </IconBtn>
          <IconBtn title="Fit to screen" onClick={() => fitToScreen(true)}>
            <FitScreenIcon />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} style={zoomIconBtnStyle}>
      {children}
    </button>
  );
}

// Renders a closed polygon plus, when selected, a draggable circular
// "handle" at every vertex — the missing edge dots the reference tool uses
// for per-point polygon editing.
function PolygonShape({
  annotationId,
  geo,
  color,
  fillOverrideColor,
  fillOverrideAlpha,
  isSelected,
  isHovered,
  locked,
  readOnly = false,
  activeTool,
  scale,
  registerRef,
  onSelect,
  onHoverIn,
  onHoverOut,
  onUpdate,
  onBeginEdit,
}: {
  annotationId: string;
  geo: PolygonGeometry;
  color: string;
  /** Selected Word's pale-blue highlight overrides the label-color fill; unset for every other case. */
  fillOverrideColor?: string;
  fillOverrideAlpha?: string;
  isSelected: boolean;
  isHovered: boolean;
  locked: boolean;
  readOnly?: boolean;
  activeTool: string;
  scale: number;
  registerRef: (node: Konva.Node | null) => void;
  onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onUpdate: (geo: PolygonGeometry) => void;
  onBeginEdit: () => void;
}) {
  const draggableWhole = activeTool === "select" && !locked && !readOnly;

  function moveVertex(index: number, x: number, y: number) {
    const nextPoints = geo.points.map((p, i) => (i === index ? ([x, y] as [number, number]) : p));
    onUpdate({ points: nextPoints });
  }

  return (
    <>
      <Line
        key={annotationId}
        ref={(node) => registerRef(node)}
        points={geo.points.flat()}
        stroke={color}
        // See the matching comment on the BBox Rect above: a constant
        // pixel width, held there by Konva itself via strokeScaleEnabled,
        // instead of `/ scale` math that a busy re-render could lag behind.
        strokeScaleEnabled={false}
        strokeWidth={
          isSelected
            ? SHAPE_STYLE.strokeWidth.selected
            : isHovered
              ? SHAPE_STYLE.strokeWidth.hover
              : SHAPE_STYLE.strokeWidth.normal
        }
        closed
        fill={
          fillOverrideColor
            ? withAlpha(fillOverrideColor, fillOverrideAlpha ?? SHAPE_STYLE.fillAlpha.selected)
            : withAlpha(
                color,
                isSelected ? SHAPE_STYLE.fillAlpha.selected : isHovered ? SHAPE_STYLE.fillAlpha.hover : SHAPE_STYLE.fillAlpha.normal
              )
        }
        shadowColor={color}
        // Literal constant — see the SHAPE_STYLE.shadow comment on the
        // BBox Rect above for why this must NOT be divided by scale.
        shadowBlur={isSelected ? SHAPE_STYLE.shadow.blurSelected : SHAPE_STYLE.shadow.blur}
        shadowOpacity={SHAPE_STYLE.shadow.opacity}
        draggable={draggableWhole}
        onClick={onSelect}
        onTap={onSelect}
        onMouseEnter={onHoverIn}
        onMouseLeave={onHoverOut}
        onDragStart={(e) => {
          e.cancelBubble = true;
          if (!readOnly) onBeginEdit();
        }}
        onDragEnd={(e) => {
          e.cancelBubble = true;
          if (readOnly) return;
          const node = e.target as Konva.Line;
          const dx = node.x();
          const dy = node.y();
          if (dx === 0 && dy === 0) return;
          onUpdate({ points: geo.points.map(([x, y]) => [x + dx, y + dy]) });
          node.position({ x: 0, y: 0 });
        }}
      />
      {isSelected &&
        !locked &&
        !readOnly &&
        geo.points.map(([x, y], i) => (
          <Circle
            key={i}
            x={x}
            y={y}
            radius={SHAPE_STYLE.vertexHandle.radius / scale}
            fill={SHAPE_STYLE.vertexHandle.fill}
            stroke={color}
            strokeScaleEnabled={false}
            strokeWidth={SHAPE_STYLE.vertexHandle.strokeWidth}
            shadowColor="#000"
            shadowBlur={1.5}
            shadowOpacity={0.25}
            draggable
            onDragStart={(e) => {
              e.cancelBubble = true;
              // One undo checkpoint per vertex-drag gesture — moveVertex
              // itself runs on every onDragMove (needed so the outline
              // visibly follows the cursor), which would otherwise flood
              // the undo stack with one entry per pixel of movement.
              if (!readOnly) onBeginEdit();
            }}
            onDragMove={(e) => {
              e.cancelBubble = true;
              moveVertex(i, e.target.x(), e.target.y());
            }}
            onDragEnd={(e) => (e.cancelBubble = true)}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "pointer";
              (e.target as Konva.Circle).radius(SHAPE_STYLE.vertexHandle.hoverRadius / scale);
              e.target.getLayer()?.batchDraw();
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = "";
              (e.target as Konva.Circle).radius(SHAPE_STYLE.vertexHandle.radius / scale);
              e.target.getLayer()?.batchDraw();
            }}
          />
        ))}
    </>
  );
}

const hudStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 12,
  background: "rgba(0,0,0,0.65)",
  color: "#fff",
  borderRadius: 6,
  padding: "5px 10px",
  fontSize: 12.5,
  pointerEvents: "none",
};

const zoomWidgetStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 12,
  left: 12,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

const zoomRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 2,
  background: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: 999,
  padding: 4,
  boxShadow: "0 2px 10px rgba(0,0,0,0.18)",
  width: "fit-content",
};

const zoomIconBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  border: "none",
  background: "transparent",
  borderRadius: 999,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--color-text-muted)",
};

const zoomStepLabelStyle: React.CSSProperties = {
  minWidth: 30,
  textAlign: "center",
  fontSize: 12,
  color: "var(--color-text-muted)",
  fontWeight: 600,
};

const zoomPctStyle: React.CSSProperties = {
  minWidth: 44,
  height: 26,
  border: "none",
  background: "transparent",
  borderRadius: 999,
  cursor: "pointer",
  fontSize: 12,
  color: "var(--color-text-muted)",
  fontWeight: 600,
};
