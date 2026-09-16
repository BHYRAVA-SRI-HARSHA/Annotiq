import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth";

export const reviewsRouter = Router();
export const consensusRouter = Router();

reviewsRouter.use(requireAuth);
consensusRouter.use(requireAuth);

const reviewSchema = z.object({
  sourceJobId: z.string(),
  decision: z.enum(["APPROVED", "REJECTED", "EDITED"]),
  diff: z.record(z.any()).optional(),
  notes: z.string().optional(),
});

// POST /reviews/:qaJobId — reviewer approves/rejects/edits a worker's annotations
reviewsRouter.post("/:qaJobId", requireRole("REVIEWER", "ADMIN"), async (req: AuthedRequest, res, next) => {
  try {
    const { sourceJobId, decision, diff, notes } = reviewSchema.parse(req.body);
    const review = await prisma.review.create({
      data: {
        qaJobId: req.params.qaJobId,
        sourceJobId,
        reviewerId: req.user!.userId,
        decision,
        diff,
        notes,
      },
    });
    res.json(review);
  } catch (err) {
    next(err);
  }
});

// GET /consensus/:taskGroupId — multi-worker comparison result
consensusRouter.get("/:taskGroupId", async (req, res, next) => {
  try {
    const result = await prisma.consensusResult.findUnique({
      where: { taskGroupId: req.params.taskGroupId },
    });
    if (!result) return res.status(404).json({ error: "No consensus result yet" });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
