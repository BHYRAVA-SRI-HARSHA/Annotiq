import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, requireRole } from "../middleware/auth";

export const customersRouter = Router();

customersRouter.use(requireAuth);

customersRouter.get("/", async (_req, res, next) => {
  try {
    const customers = await prisma.customer.findMany({ orderBy: { name: "asc" } });
    res.json({ customers });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({ name: z.string().min(1).max(120) });

customersRouter.post("/", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { name } = createSchema.parse(req.body);
    const customer = await prisma.customer.create({ data: { name } });
    res.status(201).json(customer);
  } catch (err) {
    next(err);
  }
});

customersRouter.delete("/:id", requireRole("ADMIN"), async (req, res, next) => {
  try {
    const { id } = req.params;

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    // Job.customerId has no onDelete cascade (see schema.prisma), so a
    // customer that already has queues/tasks posted under it can't just be
    // silently removed — that would either FK-error out of nowhere or,
    // worse, quietly orphan/cascade-delete real submitted work. Surface a
    // clear, actionable 409 instead of letting the raw Prisma FK
    // violation bubble up to the generic 500 handler.
    const jobCount = await prisma.job.count({ where: { customerId: id } });
    if (jobCount > 0) {
      return res.status(409).json({
        error: `"${customer.name}" has ${jobCount} queued/submitted task${jobCount === 1 ? "" : "s"} and can't be deleted. Remove or reassign those first.`,
      });
    }

    await prisma.customer.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
