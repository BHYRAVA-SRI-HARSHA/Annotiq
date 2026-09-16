// Small display-only formatting helpers. None of these touch what's
// actually stored or sent to the backend.

import type { Job } from "./api/types";

// Picks the asset ID that matches the stage being viewed — job.assetId
// for the prod submission, job.qaAssetId for the QA submission (each
// frozen at posting time by buildAssetId on the backend, e.g.
// "prodocrkv1a16092026001" / "qaocrkv1a16092026001" for the same task).
// Falls back to the other stage's id, then the job's own id, only for
// jobs posted before queueName/taskNo existed and never got either one.
export function stageAssetId(job: Job, group: "prod" | "qa"): string {
  const primary = group === "qa" ? job.qaAssetId : job.assetId;
  const fallback = group === "qa" ? job.assetId : job.qaAssetId;
  return primary ?? fallback ?? job.id;
}

// Emails are stored as lowercase, but auth.routes.ts's login lookup also
// lowercases whatever's typed in before matching it — so login itself is
// effectively case-insensitive; typing back a capitalized display value
// verbatim still logs in fine. Cosmetically re-capitalizes the local part
// + domain for the Prod users / QA users tables the way the seeded
// accounts are written everywhere else in the product ("QA1" fully
// uppercase, everything else just a leading capital):
// "prod1@annotiq.com" -> "Prod1@Annotiq.com", "qa1@annotiq.com" ->
// "QA1@Annotiq.com". Purely a display transform — the stored/login value
// is untouched.
export function prettifyEmail(email: string): string {
  const at = email.indexOf("@");
  if (at === -1) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const displayLocal = /^qa/i.test(local) ? `QA${local.slice(2)}` : local.charAt(0).toUpperCase() + local.slice(1);
  const displayDomain = domain.charAt(0).toUpperCase() + domain.slice(1);
  return `${displayLocal}@${displayDomain}`;
}

// "IN_PROGRESS" -> "IN PROGRESS", "AVAILABLE" -> "AVAILABLE", "qa" -> "QA".
// Every status shown on Prod, QA, or Admin screens should read as plain
// capitals — no title-casing, just the status in caps with underscores
// turned into spaces.
export function formatStatus(status: string): string {
  return status.toUpperCase().split("_").join(" ");
}
