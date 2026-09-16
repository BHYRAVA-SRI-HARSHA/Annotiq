import { Request, Response, NextFunction } from "express";
import { isDbUnavailableError } from "../lib/prisma";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
) {
  console.error(err);

  // A cold-start/dropped-connection error has already been retried a
  // few times (see lib/prisma.ts) by the time it gets here, so this is a
  // genuine outage, not just Neon waking up. Prisma's own message for
  // this includes the pooler hostname and, worse, the full local
  // filesystem path the backend process is running from — neither of
  // which means anything to whoever's looking at the login screen, and
  // the path is information nobody outside the team should see at all.
  // The real detail is already in the server log line above.
  if (isDbUnavailableError(err)) {
    res.status(503).json({ error: "The service is temporarily unavailable. Please try again in a moment." });
    return;
  }

  const message = err instanceof Error ? err.message : "Unexpected error";
  res.status(500).json({ error: message });
}
