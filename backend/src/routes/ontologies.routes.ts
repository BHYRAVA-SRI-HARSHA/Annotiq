import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/auth";

export const ontologiesRouter = Router();

ontologiesRouter.use(requireAuth);

// GET /ontologies/:taskType — populates the left LABELS panel for a job type
ontologiesRouter.get("/:taskType", async (req, res, next) => {
  try {
    const ontology = await prisma.labelOntology.findUnique({
      where: { taskType: req.params.taskType.toUpperCase() as any },
    });
    if (!ontology) return res.status(404).json({ error: "No ontology for this task type" });
    res.json(ontology);
  } catch (err) {
    next(err);
  }
});
