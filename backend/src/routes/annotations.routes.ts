import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { resolveStageAnnotations } from "../lib/annotationStage";

export const annotationsRouter = Router();

annotationsRouter.use(requireAuth);

// GET /jobs/:jobId/annotations — full flat list; client rebuilds the tree
// from parentAnnotationId (same approach the reference tool's right-hand
// panel uses).
//
// ?stage=prod|qa is admin's "show me exactly what this stage submitted"
// view (see AdminDocumentPage): it reads the frozen snapshot taken by
// POST /jobs/:id/submit instead of the live table, which QA's own edits
// keep mutating after prod hands a job off. Falls back to the live table
// when that stage hasn't actually been submitted yet (e.g. asking for the
// "qa" stage of a job still sitting in prod) so there's always something
// to show rather than an empty canvas. See lib/annotationStage.ts for the
// shared resolution logic.
annotationsRouter.get("/:jobId/annotations", async (req, res, next) => {
  try {
    const stage = req.query.stage === "qa" || req.query.stage === "prod" ? req.query.stage : null;
    const job = await prisma.job.findUnique({ where: { id: req.params.jobId }, select: { id: true } });
    if (!job) return res.status(404).json({ error: "Job not found" });
    const annotations = await resolveStageAnnotations(req.params.jobId, stage);
    res.json(annotations);
  } catch (err) {
    next(err);
  }
});

// `clientId` is whatever id the annotation currently has in the browser —
// a real DB id for something already saved, or a "tmp-…" id for something
// drawn/grouped since the last save. `id` is only set when the client
// already knows the real DB id. We key off `clientId` so the response can
// tell the frontend "your tmp-… shape is now real id X", and so a newly
// created parent can be referenced by a newly created child in the *same*
// batch (grouping a freshly drawn selection creates both in one save).
const annotationSchema = z.object({
  id: z.string().optional(),
  clientId: z.string(),
  labelName: z.string(),
  shapeType: z.enum(["BBOX", "POLYGON"]),
  geometry: z.record(z.any()),
  properties: z.record(z.any()).default({}),
  parentAnnotationId: z.string().nullable().optional(), // KV tree — may be a clientId from this same batch
  lineParentId: z.string().nullable().optional(), // Line tree — independent of the above, same resolution rules
});

const patchSchema = z.object({
  upserts: z.array(annotationSchema).default([]),
  deletedIds: z.array(z.string()).default([]), // real DB ids only
});

// PATCH /jobs/:jobId/annotations — batched autosave (debounced client-side)
annotationsRouter.patch("/:jobId/annotations", async (req: AuthedRequest, res, next) => {
  try {
    const jobId = req.params.jobId;
    const { upserts, deletedIds } = patchSchema.parse(req.body);
    const userId = req.user!.userId;

    const clientIdToRealId = new Map<string, string>();

    await prisma.$transaction(
      async (tx) => {
        if (deletedIds.length > 0) {
          await tx.annotation.deleteMany({ where: { id: { in: deletedIds } } });
        }

        // Phase 1: create/update every row's own fields, parent left untouched
        // for now (a referenced parent may not have a real id yet).
        for (const a of upserts) {
          if (a.id) {
            const updated = await tx.annotation.update({
              where: { id: a.id },
              data: {
                labelName: a.labelName,
                shapeType: a.shapeType,
                geometry: a.geometry,
                properties: a.properties,
              },
            });
            clientIdToRealId.set(a.clientId, updated.id);
          } else {
            const created = await tx.annotation.create({
              data: {
                jobId,
                labelName: a.labelName,
                shapeType: a.shapeType,
                geometry: a.geometry,
                properties: a.properties,
                createdById: userId,
              },
            });
            clientIdToRealId.set(a.clientId, created.id);
          }
        }

        // Phase 2: now every row in this batch has a real id, so resolve both
        // parent pointers — each is either another clientId from this same
        // batch (newly created), an already-real id (existing parent), or null.
        for (const a of upserts) {
          const realId = clientIdToRealId.get(a.clientId)!;
          const resolvedParentId = a.parentAnnotationId
            ? clientIdToRealId.get(a.parentAnnotationId) ?? a.parentAnnotationId
            : null;
          const resolvedLineParentId = a.lineParentId
            ? clientIdToRealId.get(a.lineParentId) ?? a.lineParentId
            : null;
          await tx.annotation.update({
            where: { id: realId },
            data: { parentAnnotationId: resolvedParentId, lineParentId: resolvedLineParentId },
          });
        }
      },
      // A page with a few hundred annotations (routine for a dense KV
      // form — see the reference doc's 384-annotation job) does two
      // sequential round trips per row here, which blew straight through
      // Prisma's default 5s interactive-transaction timeout and surfaced
      // to the user as "Couldn't save: Transaction API error: Transaction
      // already closed…". 30s/10s gives a big autosave batch enough room
      // to actually finish instead of getting cut off mid-transaction.
      { timeout: 30_000, maxWait: 10_000 }
    );

    const idMap = upserts.map((a) => ({ clientId: a.clientId, id: clientIdToRealId.get(a.clientId)! }));

    res.json({ savedAt: new Date().toISOString(), idMap });
  } catch (err) {
    next(err);
  }
});
