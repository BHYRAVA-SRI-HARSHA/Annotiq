import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";
import { listQueueRows, resolveQueueJobIds } from "../lib/queues";
import type { JobStatus } from "@prisma/client";

// Oversight API for the Admin dashboard — mostly read-only. The admin can
// look at who's submitted what and open the final annotated doc (which
// itself builds its structure report and PNG/PDF export entirely
// client-side, see frontend/src/features/admin/evaluationReport.ts), and
// can also delete an active queue outright (DELETE /admin/queues/:id
// below) — the one write this router allows.
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole("ADMIN"));

// Jobs in any of these statuses represent work that has actually left the
// person's hands — that's what "submitted" means for this dashboard.
// Typed (rather than `as const`) so it's a plain, mutable JobStatus[] —
// Prisma's `{ in: ... }` filter wants that exact shape, and a readonly
// tuple isn't assignable to it even though the values are identical.
const SUBMITTED_STATUSES: JobStatus[] = ["SUBMITTED", "QA", "DONE"];

// GET /admin/users?type=prod|qa
// "Prod users" are production annotators (role ANNOTATOR, working the
// OCRKV/TABLES/LAYOUT/... task types). "QA users" are reviewers (role
// REVIEWER, working the *_QA task types). Each user comes back with a
// count of how many distinct jobs they've submitted so the admin can see
// at a glance who has work to look at.
adminRouter.get("/users", async (req, res, next) => {
  try {
    const type = (req.query.type as string | undefined)?.toLowerCase() === "qa" ? "qa" : "prod";
    const role = type === "qa" ? "REVIEWER" : "ANNOTATOR";

    const users = await prisma.user.findMany({
      where: { role },
      orderBy: { email: "asc" },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    const assignments = await prisma.assignment.findMany({
      where: {
        userId: { in: users.map((u) => u.id) },
        job: { status: { in: SUBMITTED_STATUSES } },
      },
      select: { userId: true, jobId: true },
    });

    const submittedJobIdsByUser = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!submittedJobIdsByUser.has(a.userId)) submittedJobIdsByUser.set(a.userId, new Set());
      submittedJobIdsByUser.get(a.userId)!.add(a.jobId);
    }

    res.json({
      type,
      users: users.map((u) => ({
        ...u,
        submittedCount: submittedJobIdsByUser.get(u.id)?.size ?? 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/users/:userId/submissions — every job this user has submitted,
// each one differentiated by its asset id (the job's own id) plus title,
// customer, task type and status, newest first.
adminRouter.get("/users/:userId/submissions", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const assignments = await prisma.assignment.findMany({
      where: { userId: user.id, job: { status: { in: SUBMITTED_STATUSES } } },
      include: { job: { include: { customer: true } } },
      orderBy: { startedAt: "desc" },
    });

    // A job can have more than one Assignment (e.g. released and
    // restarted) — keep only the most recent one per job.
    const seenJobIds = new Set<string>();
    const jobs = [];
    for (const a of assignments) {
      if (seenJobIds.has(a.jobId)) continue;
      seenJobIds.add(a.jobId);
      jobs.push(a.job);
    }

    res.json({ user, jobs });
  } catch (err) {
    next(err);
  }
});

// GET /admin/queues?type=prod|qa&search= — every currently posted queue
// (a queue posted with 5 docs shows as one row here, same as the
// annotator-side job queue), split into production task types vs QA task
// types so the admin can see what's active on each side separately.
adminRouter.get("/queues", async (req, res, next) => {
  try {
    const type = (req.query.type as string | undefined)?.toLowerCase() === "qa" ? "qa" : "prod";
    const search = req.query.search as string | undefined;
    const rows = await listQueueRows({ group: type, search });
    res.json({ type, queues: rows });
  } catch (err) {
    next(err);
  }
});

// DELETE /admin/queues/:id?type=prod|qa — removes an entire active queue
// (every Job belonging to it) from whichever tab the admin is looking at.
// `:id` is exactly the `id` a GET /admin/queues row comes back with: a
// shared queueName for a real multi-doc queue, or a standalone job's own
// id for an older/no-queue job — see the QueueRow.id comment in
// lib/queues.ts. Scoped to the requested tab's stage statuses (via
// resolveQueueJobIds) so deleting from "Prod queues" can never reach into
// jobs of the same queueName that have already moved on to QA, and vice
// versa.
//
// A Job can't just be deleted on its own — Annotation/Assignment/Review
// rows all foreign-key onto it with no cascade configured in the schema —
// so this clears those out first, in one transaction, before removing the
// Job rows themselves. Irreversible, which is why the frontend confirms
// with the admin before ever calling this.
adminRouter.delete("/queues/:id", async (req, res, next) => {
  try {
    const type = (req.query.type as string | undefined)?.toLowerCase() === "qa" ? "qa" : "prod";
    const jobIds = await resolveQueueJobIds(req.params.id, type);
    if (jobIds.length === 0) {
      return res.status(404).json({ error: "Queue not found" });
    }

    await prisma.$transaction([
      prisma.review.deleteMany({ where: { OR: [{ qaJobId: { in: jobIds } }, { sourceJobId: { in: jobIds } }] } }),
      prisma.annotation.deleteMany({ where: { jobId: { in: jobIds } } }),
      prisma.assignment.deleteMany({ where: { jobId: { in: jobIds } } }),
      prisma.job.deleteMany({ where: { id: { in: jobIds } } }),
    ]);

    res.json({ deleted: jobIds.length });
  } catch (err) {
    next(err);
  }
});

