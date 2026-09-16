import express from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { authRouter } from "./routes/auth.routes";
import { jobsRouter } from "./routes/jobs.routes";
import { annotationsRouter } from "./routes/annotations.routes";
import { ontologiesRouter } from "./routes/ontologies.routes";
import { reviewsRouter, consensusRouter } from "./routes/reviews.routes";
import { customersRouter } from "./routes/customers.routes";
import { adminRouter } from "./routes/admin.routes";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // CORS_ORIGIN accepts one origin or a comma-separated list, so a
  // deployment can allow both a production frontend domain and a preview
  // deploy (or staging) without code changes.
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());

  // Serves backend/public/uploads — documents the admin dashboard posts as
  // new jobs land here (see middleware/upload.ts), at GET /uploads/<file>.
  const uploadsDir = path.join(__dirname, "..", "public", "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use("/uploads", express.static(uploadsDir));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", authRouter);
  app.use("/jobs", jobsRouter);
  // annotations are nested under /jobs/:jobId/annotations
  app.use("/jobs", annotationsRouter);
  app.use("/ontologies", ontologiesRouter);
  app.use("/reviews", reviewsRouter);
  app.use("/consensus", consensusRouter);
  app.use("/customers", customersRouter);
  app.use("/admin", adminRouter);

  app.use(errorHandler);

  return app;
}
