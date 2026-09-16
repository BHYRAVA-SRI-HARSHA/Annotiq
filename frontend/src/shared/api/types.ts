export type UserRole = "ANNOTATOR" | "REVIEWER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}

export type TaskType =
  | "OCRKV"
  | "TABLES"
  | "LAYOUT"
  | "SEGRECT"
  | "TRANSCRIPTION_CONSENSUS"
  | "OCRKV_QA"
  | "TABLES_QA"
  | "LAYOUT_QA";

export type JobStatus = "AVAILABLE" | "IN_PROGRESS" | "SUBMITTED" | "QA" | "DONE";

// One row in the job-picking queue (GET /jobs/queues, GET /admin/queues) —
// every task posted under one queueName collapsed to its aggregate counts,
// or a lone pre-queueName job treated as its own single-document "queue".
// `jobIds` lets a read-only preview (admin) jump straight to a
// document without going through the assign-and-pick flow real
// annotators/QA use.
export interface QueueRow {
  id: string;
  title: string;
  taskType: TaskType;
  customer?: Customer;
  createdAt: string;
  totalDocs: number;
  availableDocs: number;
  status: JobStatus;
  jobIds: string[];
  hasResumableForUser: boolean;
}

export interface Customer {
  id: string;
  name: string;
}

export interface Job {
  id: string;
  title: string;
  // Name of the queue this task was posted as part of — see Admin's
  // "Post a new queue" form. Nullable for tasks posted before this existed.
  queueName?: string | null;
  // This task's 1-based position within its queue at posting time (see
  // buildAssetId on the backend) — nullable alongside assetId for tasks
  // posted before this existed.
  taskNo?: number | null;
  // prod<queueName, sanitized><DDMMYYYY posting date><taskNo, zero-padded
  // to 3 digits>, e.g. "prodocrkv1a16092026001" — generated once at
  // posting time and frozen from then on. Nullable for tasks posted
  // before this existed; the UI falls back to `id` in that case (see
  // stageAssetId in shared/format.ts).
  assetId?: string | null;
  // Same task's QA-stage asset ID, e.g. "qaocrkv1a16092026001" — see
  // assetId above; generated and frozen alongside it.
  qaAssetId?: string | null;
  taskType: TaskType;
  status: JobStatus;
  customerId: string;
  customer?: Customer;
  sourceImageUrl: string;
  instructionsMd?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ShapeType = "BBOX" | "POLYGON";

// Sec. 6 (Word Properties) + Sec. 7 (Transcription Rules) of ANNOTATION_RULES.md.
export type WritingType = "Handwritten" | "Printed";

// Sec. 7.1/7.5/7.8: reasons a Word is left untranscribed instead of guessed.
export type SkipReason =
  | "Blurry"
  | "UnknownScript"
  | "InvertedText"
  | "Unreadable"
  | "Redacted";

export interface AnnotationProperties {
  transcription?: string;
  language?: string;
  skipTranscription?: boolean;
  skipReason?: SkipReason;
  writingType?: WritingType;
  isVertical?: boolean;
  isSignature?: boolean;
  isWatermark?: boolean;
  isBoxForm?: boolean; // Sec. 4.5 — box-form cell content
  isMath?: boolean; // Sec. 9 — inline/display equation term
  isLatex?: boolean;
  strikeThrough?: boolean; // Sec. 7.8 — legible but struck-through
  rotationAngle?: number; // Sec. 4.6 — rotated (non-vertical) words
  textAlignment?: number; // Sec. 7.9 — set before transcribing a rotated polygon word
  [key: string]: unknown;
}

export interface BBoxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  // Degrees, clockwise, around the box's own center. Optional/undefined
  // means 0 (the vast majority of boxes) — added for the Transformer's
  // rotate handle (the "stick" off the top-center) so a bbox can be
  // tilted to match printed/handwritten text that isn't perfectly
  // horizontal on the page, without having to redraw it as a polygon.
  // Note: overlap/containment helpers elsewhere (wordsCoveredBy,
  // containerFor, group auto-fit, etc.) still treat x/y/width/height as
  // axis-aligned and ignore this field — a heavily rotated box may not
  // interact correctly with those; this covers the direct "tilt it to
  // match the text" use case, not full rotated-rect geometry everywhere.
  rotation?: number;
}

export interface PolygonGeometry {
  points: [number, number][];
}

export interface Annotation {
  id: string;
  jobId: string;
  labelName: string;
  shapeType: ShapeType;
  geometry: BBoxGeometry | PolygonGeometry;
  properties: AnnotationProperties;
  parentAnnotationId: string | null; // KV/container tree (see state/types.ts)
  lineParentId: string | null; // OCR line tree — independent of the above
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabelDef {
  name: string;
  color: string;
  shape: "bbox" | "polygon";
  parentLabel?: string;
}

export interface LabelOntology {
  id: string;
  taskType: TaskType;
  labels: LabelDef[];
}
