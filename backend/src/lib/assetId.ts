// Asset ID generation for a posted task.
//
// A task gets TWO asset IDs, one per stage it passes through — a prod
// one and a QA one — built from the same queue name, task number and
// posting date, differing only by their "prod"/"qa" prefix:
//
// Format: <stage><queue name, sanitized><DDMMYYYY posting date><task
// number, zero-padded to 3 digits>, all run together with no separators
// — e.g. queue "ocrkv-1a", task 1, posted 16/9/2026 ->
//   prod: "prodocrkv1a16092026001"
//   qa:   "qaocrkv1a16092026001"
//   - "prod" / "qa"  -> stage, passed in verbatim
//   - "ocrkv-1a"     -> sanitizeQueueName -> "ocrkv1a"    (hyphen dropped)
//   - 16/9/2026      -> formatDateDDMMYYYY -> "16092026"  (day/month
//     zero-padded to 2 digits, 4-digit year, no slashes)
//   - taskNo 1       -> formatTaskNo -> "001"             (zero-padded
//     to 3 digits; a queue that reaches task 1000+ just grows past the
//     padding rather than truncating)
//   "prod" + "ocrkv1a" + "16092026" + "001" = "prodocrkv1a16092026001"
//
// Both are assigned once, at the moment a task is posted (see POST
// /jobs), and stored on the Job row rather than recomputed on the fly —
// the queue's task count keeps growing after this task is posted, and
// the calendar date obviously moves on, so recomputing later would
// silently change an already-issued asset ID.

export type AssetStage = "prod" | "qa";

// Keeps letters and digits only. A queue name is free text in the "Post a
// new queue" form (spaces, hyphens, punctuation all get typed there), but
// an asset ID reads as one identifier with no delimiters, so anything
// that isn't alphanumeric is simply dropped rather than swapped for
// another separator that would just move the ambiguity elsewhere.
export function sanitizeQueueName(queueName: string): string {
  return queueName.replace(/[^a-zA-Z0-9]/g, "");
}

// DDMMYYYY, always 8 digits, no separators — day and month zero-padded,
// matching the "16/9/2026" -> "16092026" example exactly (day is already
// two digits there; the month is the one that needs padding).
export function formatDateDDMMYYYY(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}${month}${year}`;
}

// Zero-pads the task number to 3 digits, e.g. 1 -> "001", 42 -> "042".
export function formatTaskNo(taskNo: number): string {
  return String(taskNo).padStart(3, "0");
}

export function buildAssetId(
  stage: AssetStage,
  queueName: string,
  taskNo: number,
  date: Date = new Date()
): string {
  return `${stage}${sanitizeQueueName(queueName)}${formatDateDDMMYYYY(date)}${formatTaskNo(taskNo)}`;
}
