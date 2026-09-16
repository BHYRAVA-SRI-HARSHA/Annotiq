import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.parse(req.body);
    // Emails are case-insensitive everywhere else in the world, so treat
    // them that way here too — otherwise "Prod1@Annotiq.com" and
    // "prod1@annotiq.com" would silently be two different accounts (or
    // whichever casing wasn't seeded would just fail to log in at all).
    const email = parsed.email.trim().toLowerCase();
    const password = parsed.password;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const payload = { userId: user.id, role: user.role };
    res.json({
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken(payload),
      user: { id: user.id, email: user.email, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

const refreshSchema = z.object({ refreshToken: z.string() });

authRouter.post("/refresh", (req, res, next) => {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    const payload = verifyRefreshToken(refreshToken);
    res.json({ accessToken: signAccessToken(payload) });
  } catch (err) {
    next(err);
  }
});
