import { prisma } from "./prisma";
import type { JobStatus } from "@prisma/client";

// A job's *status* — not its task type — is what decides whether it's
// prod's work or QA's work right now. One job flows through both stages
// over its lifetime: AVAILABLE -> IN_PROGRESS (prod working) -> SUBMITTED
// -> QA (a reviewer working) -> DONE. So "group=prod" means "currently in
// the prod stage" and "group=qa" means "currently in the QA stage" — the
// same job shows up in exactly one of the two queues at any given moment,
// and moves itself from one to the other purely by changing status (see
// jobs.routes.ts' pick/submit/release handlers).
export const PROD_STAGE_STATUSES = ["AVAILABLE", "IN_PROGRESS"] as const;
export const QA_STAGE_STATUSES = ["SUBMITTED", "QA"] as const;

// Within a stage, this is the "unclaimed, anyone can pick it up" status —
// AVAILABLE for prod, SUBMITTED for qa (its IN_PROGRESS-equivalent).
function pickableStatusFor(group: "prod" | "qa"): string {
  return group === "qa" ? "SUBMITTED" : "AVAILABLE";
}

const STATUS_PRIORITY = ["AVAILABLE", "IN_PROGRESS", "SUBMITTED", "QA", "DONE"] as const;
function summarizeStatus(statuses: string[]): string {
  for (const s of STATUS_PRIORITY) if (statuses.includes(s)) return s;
  return statuses[0] ?? "AVAILABLE";
}

// A "queue row" is what the job-picking UI (and the admin's active-queues
// view) renders — one row per queueName, however many documents (Jobs)
// were posted under it, or one row per job for older/standalone jobs that
// have no queueName. This is what posting 5 docs under one queue name
// collapses down to: the queue shows "Ocr-kv-1a", not five separate rows.
export interface QueueRow {
  id: string; // queueName, or the job's own id for a standalone (no-queue) job
  title: string;
  taskType: string;
  customer?: { id: string; name: string } | null;
  createdAt: Date;
  totalDocs: number;
  availableDocs: number;
  status: string;
  jobIds: string[];
  // True when the calling user specifically (not just anyone) has a
  // document in this queue sitting mid-work from a "Stop and resume
  // later" — i.e. clicking "Start working" on this row will send them
  // straight back into that same document (see the /queues/:id/pick
  // resume check) rather than handing them a fresh one. Surfaced
  // separately from the aggregate `status` because that field reflects
  // ALL documents in the queue, not this particular user's own paused
  // work — a queue could show "Available" overall while this user still
  // has something of their own paused inside it.
  hasResumableForUser: boolean;
}

export interface ListQueueRowsParams {
  search?: string;
  group?: "prod" | "qa";
  status?: string;
  userId?: string;
}

export async function listQueueRows({ search, group, status, userId }: ListQueueRowsParams): Promise<QueueRow[]> {
  const where: Record<string, unknown> = {};
  // An explicit ?status= always wins; otherwise a requested group implies
  // its own stage's statuses, so a prod job that's already moved on to QA
  // (or vice versa) never shows up in the wrong queue.
  if (status) {
    where.status = status.toUpperCase();
  } else if (group) {
    where.status = { in: group === "qa" ? QA_STAGE_STATUSES : PROD_STAGE_STATUSES };
  }
  if (search) where.OR = [
    { title: { contains: search, mode: "insensitive" as const } },
    { queueName: { contains: search, mode: "insensitive" as const } },
  ];

  const jobs = await prisma.job.findMany({
    where,
    include: { customer: true },
    orderBy: { createdAt: "desc" },
  });

  const byQueue = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const key = job.queueName && job.queueName.trim() ? `q:${job.queueName}` : `j:${job.id}`;
    if (!byQueue.has(key)) byQueue.set(key, []);
    byQueue.get(key)!.push(job);
  }

  const pickable = group ? pickableStatusFor(group) : "AVAILABLE";
  // The in-progress-for-this-role status (IN_PROGRESS for prod, QA for
  // reviewers) is exactly what a resumed job sits at — see the matching
  // check in POST /queues/:id/pick.
  const inProgressStatus = group === "qa" ? "QA" : "IN_PROGRESS";
  let resumableJobIds = new Set<string>();
  if (userId) {
    const myActiveAssignments = await prisma.assignment.findMany({
      where: {
        userId,
        releasedAt: null,
        job: { status: inProgressStatus, id: { in: jobs.map((j) => j.id) } },
      },
      select: { jobId: true },
    });
    resumableJobIds = new Set(myActiveAssignments.map((a) => a.jobId));
  }

  const rows: QueueRow[] = Array.from(byQueue.entries()).map(([key, groupJobs]) => {
    const first = groupJobs[0];
    const isQueue = key.startsWith("q:");
    return {
      id: isQueue ? first.queueName! : first.id,
      title: isQueue ? first.queueName! : first.title,
      taskType: first.taskType,
      customer: first.customer,
      createdAt: groupJobs.reduce((min, j) => (j.createdAt < min ? j.createdAt : min), first.createdAt),
      totalDocs: groupJobs.length,
      availableDocs: groupJobs.filter((j) => j.status === pickable).length,
      status: summarizeStatus(groupJobs.map((j) => j.status)),
      jobIds: groupJobs.map((j) => j.id),
      hasResumableForUser: groupJobs.some((j) => resumableJobIds.has(j.id)),
    };
  });

  rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows;
}

// Resolves a queue row's `id` (as handed back by listQueueRows above — a
// queueName for a real multi-doc queue, or a bare job id for a
// standalone/no-queueName job) back to the concrete Job ids it stands for,
// scoped to the given stage's statuses so deleting a row from, say, the
// admin dashboard's "QA queues" tab only ever removes the jobs that are
// actually sitting in that tab right now — never a same-named batch of
// jobs that have already moved on to (or haven't yet reached) the other
// stage.
export async function resolveQueueJobIds(id: string, group: "prod" | "qa"): Promise<string[]> {
  // Prisma's `{ in: ... }` filter wants a plain mutable JobStatus[] — the
  // same readonly-tuple mismatch called out on SUBMITTED_STATUSES in
  // admin.routes.ts, so this copies into a fresh mutable array rather than
  // passing the readonly tuple straight through.
  const statuses: JobStatus[] = group === "qa" ? [...QA_STAGE_STATUSES] : [...PROD_STAGE_STATUSES];

  const queueJobs = await prisma.job.findMany({
    where: { queueName: id, status: { in: statuses } },
    select: { id: true },
  });
  if (queueJobs.length > 0) return queueJobs.map((j) => j.id);

  // Not a queueName match — fall back to treating `id` as a standalone
  // job's own id, exactly like the "j:" branch of the grouping above.
  const single = await prisma.job.findFirst({
    where: { id, status: { in: statuses } },
    select: { id: true },
  });
  return single ? [single.id] : [];
}
