import { prisma } from "./prisma";
import type { Annotation } from "@prisma/client";

export type Stage = "prod" | "qa";

// Mirrors GET /jobs/:jobId/annotations?stage= in annotations.routes.ts:
// reads the frozen snapshot POST /jobs/:id/submit took at hand-off time for
// that stage, falling back to the live table when that stage hasn't been
// submitted yet.
export async function resolveStageAnnotations(jobId: string, stage: Stage | null): Promise<Annotation[]> {
  if (stage) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { prodSubmittedSnapshot: true, qaSubmittedSnapshot: true },
    });
    const snapshot = stage === "qa" ? job?.qaSubmittedSnapshot : job?.prodSubmittedSnapshot;
    if (snapshot) return snapshot as unknown as Annotation[];
    // No snapshot yet for this stage — fall through to live annotations.
  }

  return prisma.annotation.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
  });
}
