import { Prisma, PrismaClient } from "@prisma/client";

// Single shared Prisma instance. In dev with ts-node-dev's respawn,
// stash it on `global` so hot reloads don't open a new pool each time.
declare global {
  // eslint-disable-next-line no-var
  var __prisma: ReturnType<typeof createPrismaClient> | undefined;
}

// Neon (and most other serverless/autosuspending Postgres — Supabase's
// free tier does the same) puts the database to sleep after a few minutes
// idle and takes a couple of seconds to wake back up. Without this, the
// first query after any idle period — very often the login query, since
// that's the first thing a new session does — surfaces to the person as a
// raw "Can't reach database server at ep-....neon.tech:5432" crash instead
// of just... working a moment later. Transparently retry a handful of
// times with a short backoff before actually giving up, so a cold start
// costs an extra second or two instead of an error page.
const RETRYABLE_PRISMA_CODES = new Set([
  "P1001", // Can't reach database server
  "P1002", // Database server was reached but timed out
  "P1008", // Operation timed out
  "P1017", // Server has closed the connection
]);
const MAX_DB_RETRIES = 4;
const RETRY_DELAY_MS = 500;

export function isDbUnavailableError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return RETRYABLE_PRISMA_CODES.has(err.code);
  // A raw connection-refused/reset error can occasionally surface
  // un-wrapped (e.g. from the underlying connection pool) rather than as
  // one of the typed Prisma error classes above.
  if (err instanceof Error) {
    return /can't reach database server|connection.*(closed|reset|refused)|timed out/i.test(err.message);
  }
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPrismaClient() {
  return new PrismaClient().$extends({
    name: "retry-on-cold-start",
    query: {
      async $allOperations({ model, operation, args, query }) {
        let attempt = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          try {
            return await query(args);
          } catch (err) {
            attempt += 1;
            if (attempt > MAX_DB_RETRIES || !isDbUnavailableError(err)) throw err;
            console.warn(
              `[prisma] ${model ?? ""}.${operation} — database unreachable, retrying (${attempt}/${MAX_DB_RETRIES})…`
            );
            await delay(RETRY_DELAY_MS * attempt);
          }
        }
      },
    },
  });
}

export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
