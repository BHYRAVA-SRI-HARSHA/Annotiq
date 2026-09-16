import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";
import { uploadDocument } from "../middleware/upload";
import { listQueueRows } from "../lib/queues";
import { buildAssetId } from "../lib/assetId";

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

// GET /jobs/queues?status=&search=&group=prod|qa — queue listing used by
// the annotator/QA job-picking UI. One row per queueName (however many
// documents it holds), or one row per job for pre-queueName/standalone
// jobs. MUST be registered before GET /:id, or Express would treat
// "queues" as an :id value on that route instead.
jobsRouter.get("/queues", async (req: AuthedRequest, res, next) => {
  try {
    const { status, search, group } = req.query as Record<string, string>;
    const rows = await listQueueRows({
      status,
      search,
      group: group === "qa" ? "qa" : group === "prod" ? "prod" : undefined,
      userId: req.user!.userId,
    });
    res.json({ queues: rows, total: rows.length });
  } catch (err) {
    next(err);
  }
});

// POST /jobs/queues/:queueId/pick — resolve a queue row (queueName, or a
// standalone job's own id) to one specific document within it that's
// unclaimed *for this user's stage*, assign it to the caller, and hand
// back its job id to open. A REVIEWER picks from SUBMITTED docs (moving
// them to QA); anyone else picks from AVAILABLE docs (moving them to
// IN_PROGRESS) — see pickableStatus/nextStatus below. Prefers a document
// this user hasn't already picked up before (and skipped/released) so
// re-entering the same queue shuffles them into something new rather than
// the one they just put down.
jobsRouter.post("/queues/:queueId/pick", async (req: AuthedRequest, res, next) => {
  try {
    const queueId = decodeURIComponent(req.params.queueId);
    const userId = req.user!.userId;
    const isReviewer = req.user!.role === "REVIEWER";
    const pickableStatus = isReviewer ? "SUBMITTED" : "AVAILABLE";
    const nextStatus = isReviewer ? "QA" : "IN_PROGRESS";

    // Resume-in-progress check: "Stop and resume later" leaves the job
    // assigned (Assignment.releasedAt still null) and sitting at
    // `nextStatus` already (QA/IN_PROGRESS) rather than back in the
    // pickable pool, so without this check the query below would only
    // ever look at AVAILABLE/SUBMITTED jobs and could never find it again
    // — from the person's point of view the document they stopped on had
    // simply vanished. Route them straight back into it instead of
    // rolling a new one.
    const resumable = await prisma.job.findFirst({
      where: {
        status: nextStatus,
        OR: [{ queueName: queueId }, { id: queueId }],
        assignments: { some: { userId, releasedAt: null } },
      },
    });
    if (resumable) {
      return res.json({ jobId: resumable.id, resumed: true });
    }

    let candidates = await prisma.job.findMany({ where: { queueName: queueId, status: pickableStatus } });
    if (candidates.length === 0) {
      // Not a named queue (or nothing left in it) — fall back to treating
      // the id as a standalone job id, for pre-queueName data / direct links.
      const soloJob = await prisma.job.findUnique({ where: { id: queueId } });
      if (soloJob && soloJob.status === pickableStatus) candidates = [soloJob];
    }

    if (candidates.length === 0) {
      return res.status(409).json({ error: "No available documents left in this queue right now." });
    }

    const candidateIds = candidates.map((j) => j.id);
    const alreadyTried = await prisma.assignment.findMany({
      where: { jobId: { in: candidateIds }, userId },
      select: { jobId: true },
    });
    const triedIds = new Set(alreadyTried.map((a) => a.jobId));
    const fresh = candidates.filter((j) => !triedIds.has(j.id));
    const pool = fresh.length > 0 ? fresh : candidates;

    // The `candidates` query above and this write are two separate round
    // trips, so two people opening the same queue at the same instant can
    // both read the same document as pickableStatus before either has
    // written anything back — a plain "pick one, then update it" would let
    // both of them succeed and silently double-assign it. Guarding the
    // write with `status: pickableStatus` closes that window: this becomes
    // a single atomic UPDATE ... WHERE at the database level, so only
    // whichever request gets there first actually flips the status — the
    // loser's updateMany matches zero rows (the status has already moved
    // on) and falls through to try the next candidate instead. This is
    // what makes "prod2 can't see/grab a task prod1 already picked" hold
    // even under concurrent picks, not just once the first write commits.
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    let picked: (typeof shuffled)[number] | null = null;
    for (const candidate of shuffled) {
      const result = await prisma.job.updateMany({
        where: { id: candidate.id, status: pickableStatus },
        data: { status: nextStatus },
      });
      if (result.count === 1) {
        picked = candidate;
        break;
      }
      // Someone else grabbed this one a moment ago — try the next.
    }

    if (!picked) {
      return res.status(409).json({ error: "No available documents left in this queue right now." });
    }

    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h hold
    await prisma.assignment.create({ data: { jobId: picked.id, userId, expiresAt } });

    res.json({ jobId: picked.id });
  } catch (err) {
    next(err);
  }
});

// GET /jobs?status=&search=&page= — raw per-document listing. Not used by
// any current frontend page (the admin dashboard works off queue rows via
// GET /jobs/queues, and per-user submissions via GET /admin/users/:id/
// submissions) — kept as a general-purpose read endpoint.
jobsRouter.get("/", async (req, res, next) => {
  try {
    const { status, search, page = "1" } = req.query as Record<string, string>;
    const pageSize = 15;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);

    // status can be a single value ("SUBMITTED") or a comma-separated list
    // ("SUBMITTED,QA") — the admin dashboard's "received from production"
    // list needs the latter so a job doesn't disappear from it the moment
    // a QA reviewer picks it up (status flips SUBMITTED -> QA).
    const statuses = status ? status.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];

    const where = {
      ...(statuses.length === 1
        ? { status: statuses[0] as any }
        : statuses.length > 1
        ? { status: { in: statuses as any[] } }
        : {}),
      ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    };

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.job.count({ where }),
    ]);

    res.json({ jobs, total, page: pageNum, pageSize });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/:id", async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: { customer: true },
    });
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    next(err);
  }
});

const TASK_TYPES = [
  "OCRKV",
  "TABLES",
  "LAYOUT",
  "SEGRECT",
  "TRANSCRIPTION_CONSENSUS",
  "OCRKV_QA",
  "TABLES_QA",
  "LAYOUT_QA",
] as const;

const createJobSchema = z.object({
  title: z.string().min(1).max(200),
  queueName: z.string().min(1).max(200),
  taskType: z.enum(TASK_TYPES),
  customerId: z.string().min(1),
  instructionsMd: z.string().max(20000).optional(),
});

// POST /jobs — admin uploads a source document and posts it as a
// new task, as part of a named queue, for production annotators.
// multipart/form-data: file field "document" plus the createJobSchema
// fields.
jobsRouter.post("/", requireRole("ADMIN"), uploadDocument.single("document"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "A source document file is required." });

    const parsed = createJobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid task details." });
    }
    const { title, queueName, taskType, customerId, instructionsMd } = parsed.data;

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) return res.status(400).json({ error: "Unknown customer." });

    const assetBase = process.env.PUBLIC_ASSET_BASE ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const sourceImageUrl = `${assetBase}/uploads/${req.file.filename}`;

    // This task's 1-based position within its queue — "task 1" is
    // whichever job is the first ever posted to this queueName, "task 2"
    // the next, and so on, counting only what's already there so this
    // never has to be edited by hand. A raw count-then-create has a
    // narrow race window (two admins posting to the same queue at the
    // exact same instant could get the same taskNo/assetId) that a
    // serialized transaction would close, but queue posting is an
    // infrequent, one-at-a-time admin action in practice, and assetId
    // stays unique-constrained at the DB level regardless, so a genuine
    // collision fails loudly (a 500 from the create below) instead of
    // silently double-issuing an asset ID.
    const existingInQueue = await prisma.job.count({ where: { queueName } });
    const taskNo = existingInQueue + 1;
    const postedAt = new Date();
    // Both stage asset IDs are built from the same queueName/taskNo/date,
    // differing only by their "prod"/"qa" prefix — see buildAssetId.
    const assetId = buildAssetId("prod", queueName, taskNo, postedAt);
    const qaAssetId = buildAssetId("qa", queueName, taskNo, postedAt);

    const job = await prisma.job.create({
      data: {
        title,
        queueName,
        taskType,
        customerId,
        sourceImageUrl,
        instructionsMd,
        taskNo,
        assetId,
        qaAssetId,
        createdAt: postedAt,
      },
      include: { customer: true },
    });
    res.status(201).json(job);
  } catch (err) {
    next(err);
  }
});

// DELETE /jobs/:id — admin pulls a posted job back out of the queue.
jobsRouter.delete("/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    await prisma.annotation.deleteMany({ where: { jobId: req.params.id } });
    await prisma.assignment.deleteMany({ where: { jobId: req.params.id } });
    await prisma.job.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /jobs/:id/start — direct-by-id "Start working" (legacy path; the
// job queue UI now goes through /jobs/queues/:queueId/pick instead, but
// this is kept stage-aware the same way for any direct caller).
jobsRouter.post("/:id/start", async (req: AuthedRequest, res, next) => {
  try {
    const jobId = req.params.id;
    const userId = req.user!.userId;
    const isReviewer = req.user!.role === "REVIEWER";
    const nextStatus = isReviewer ? "QA" : "IN_PROGRESS";
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h hold

    const [assignment] = await prisma.$transaction([
      prisma.assignment.create({ data: { jobId, userId, expiresAt } }),
      prisma.job.update({ where: { id: jobId }, data: { status: nextStatus } }),
    ]);
    res.json(assignment);
  } catch (err) {
    next(err);
  }
});

// Shared by /release and /skip: hand the document back to the pool it
// belongs to (so it can be picked up — by this user or anyone else —
// again) and close out this user's current assignment on it, so the
// queue-pick logic above knows they've already tried this particular
// document before and offers something else the next time they reopen the
// same queue. A job being reviewed (status QA) goes back to SUBMITTED —
// the QA pool — never all the way back to AVAILABLE/the prod pool.
//
// wipeAnnotations (Release only, never Skip) additionally clears
// whatever's been drawn so far, so the next person to pick this document
// up — themselves included — gets a genuinely fresh, blank document
// instead of inheriting a half-finished draft. Scoped to prod-stage
// releases only (revertStatus === "AVAILABLE"): a QA reviewer releasing a
// job back to SUBMITTED must never wipe it — that would destroy the
// production annotator's actual submitted work, not just an abandoned QA
// pass over it.
async function releaseBackToPool(jobId: string, userId?: string, wipeAnnotations = false) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
  const revertStatus = job?.status === "QA" ? "SUBMITTED" : "AVAILABLE";

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.job.update({ where: { id: jobId }, data: { status: revertStatus } }),
  ];
  if (userId) {
    ops.push(
      prisma.assignment.updateMany({
        where: { jobId, userId, releasedAt: null },
        data: { releasedAt: new Date() },
      })
    );
  }
  if (wipeAnnotations && revertStatus === "AVAILABLE") {
    ops.push(prisma.annotation.deleteMany({ where: { jobId } }));
  }
  await prisma.$transaction(ops);
}

jobsRouter.post("/:id/release", async (req: AuthedRequest, res, next) => {
  try {
    await releaseBackToPool(req.params.id, req.user?.userId, true);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/skip", async (req: AuthedRequest, res, next) => {
  try {
    await releaseBackToPool(req.params.id, req.user?.userId, false);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/decline", async (req, res, next) => {
  try {
    // Decline reasons + an audit log entry aren't persisted yet — this
    // just acknowledges the decline so the job can be routed back to the
    // pool by a subsequent /release call.
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /jobs/:id/submit — advances the job to the next stage: a prod
// annotator submitting (job currently IN_PROGRESS) moves it to SUBMITTED,
// dropping it out of the prod queue and into the QA queue; a QA reviewer
// submitting (job currently QA) moves it to DONE, closing it out for good.
// Driven entirely by the job's own current status, so the same endpoint
// (and the same frontend "Submit" button) works for both stages.
jobsRouter.post("/:id/submit", async (req, res, next) => {
  try {
    const job = await prisma.job.findUnique({ where: { id: req.params.id }, select: { status: true } });
    if (!job) return res.status(404).json({ error: "Job not found" });
    const nextStatus = job.status === "QA" ? "DONE" : "SUBMITTED";

    // Freeze exactly what's being handed off right now — see the schema
    // comment on prodSubmittedSnapshot/qaSubmittedSnapshot for why this
    // can't just be "read the live annotations later": the next stage
    // edits those same rows, so without a snapshot admin can never again
    // see what this stage actually submitted.
    const currentAnnotations = await prisma.annotation.findMany({
      where: { jobId: req.params.id },
      orderBy: { createdAt: "asc" },
    });
    const snapshotField = job.status === "QA" ? "qaSubmittedSnapshot" : "prodSubmittedSnapshot";

    await prisma.job.update({
      where: { id: req.params.id },
      data: { status: nextStatus, [snapshotField]: currentAnnotations },
    });
    res.json({ ok: true, status: nextStatus });
  } catch (err) {
    next(err);
  }
});
