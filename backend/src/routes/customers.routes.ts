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
