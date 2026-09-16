import jwt, { type SignOptions } from "jsonwebtoken";

export interface AccessTokenPayload {
  userId: string;
  role: "ANNOTATOR" | "REVIEWER" | "ADMIN";
}

// Falling back to a fixed dev secret is fine for a local sandbox but would
// mean anyone could forge a valid token against a deployed instance, so
// the fallback is refused outright once NODE_ENV=production — better to
// fail loudly at startup than silently sign tokens with a known secret.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)
) {
  throw new Error(
    "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set in production — refusing to start with the dev default."
  );
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret";
// @types/jsonwebtoken types `expiresIn` as `number | StringValue`, where
// StringValue is a branded template-literal type (from the `ms` package)
// — not plain `string`. An env var read via `process.env.X ?? "15m"` is
// always widened to `string`, so it can never satisfy that on its own; the
// cast below is safe because jsonwebtoken validates the format itself at
// call time and throws if it's not actually a valid ms-style string (or a
// bare number of seconds).
const ACCESS_TTL = (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"];
const REFRESH_TTL = (process.env.JWT_REFRESH_TTL ?? "7d") as SignOptions["expiresIn"];

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}

export function signRefreshToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, REFRESH_SECRET) as AccessTokenPayload;
}
