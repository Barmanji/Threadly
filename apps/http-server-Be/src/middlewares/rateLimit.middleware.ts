import { Request, Response } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { ApiError } from "../utils/ApiError.js";

/**
 * Rate limits for the unauthenticated credential endpoints.
 *
 * The global limiter allows 5000 requests per 15 minutes per IP, which is a
 * ceiling on total traffic rather than a control on guessing passwords. These
 * two are the ones that matter for credential attacks: one bounds how fast an
 * IP can hammer the auth surface at all, and one bounds how many *failures* a
 * single account can accumulate no matter where they come from.
 */

const WINDOW_MS = 15 * 60 * 1000;

/** Mirror the global limiter's handler so a 429 looks the same to the client. */
const tooMany = (limit: unknown, windowMs: number): never => {
  // `limit` is typed as a number or a function because the library allows a
  // computed limit; both call sites here pass a literal, and interpolating a
  // function would be nonsense, so it is resolved once for the message.
  const shown = typeof limit === "number" ? limit : "some";
  throw new ApiError(
    429,
    `Too many attempts. You are only allowed ${shown} attempts per ${
      windowMs / 60000
    } minutes. Try again later.`,
  );
};

/**
 * Per-IP cap across the credential endpoints, counting successes as well as
 * failures.
 *
 * Deliberately generous, and deliberately counting every request: the failure
 * of a correct login is not the attack this guards. Mass account registration is
 * (it sends mail, and it bills the owner's provider), and that only shows up as
 * *successful* requests, so skipping successful requests here would defeat the
 * point. A shared address — a household, an office, a carrier CGNAT range —
 * spends the whole budget between its users, and local development from
 * 127.0.0.1 spends it between everyone testing, so this number has to leave
 * real headroom. It still bounds spraying at ~200 attempts an hour per host,
 * while `authAccountLimiter` is what bounds any one account.
 */
const authIpLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 50,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req: Request, res: Response) => {
    return (req.clientIp || ipKeyGenerator(req.ip || "")) ?? "unknown";
  },
  handler: (_req, _res, __, options) => tooMany(options.limit, options.windowMs),
});

/**
 * Per-account cap on *failed* attempts, keyed on the submitted identifier.
 *
 * `skipSuccessfulRequests` means only failures are counted, so a real user who
 * signs in correctly is never throttled no matter how many times they log in.
 * Keying on the identifier rather than the IP is what makes this immune to IP
 * rotation and to shared addresses; `authIpLimiter` covers the spraying case.
 *
 * Requests with no usable identifier fall back to an IP bucket. Without this,
 * every malformed request would share the single key `""` and one attacker could
 * lock out all unauthenticated traffic for the window.
 */
const authAccountLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { username?: unknown; email?: unknown };
    const identifier = (body.username || body.email || "")
      .toString()
      .trim()
      .toLowerCase()
      .slice(0, 200);
    if (!identifier) {
      return `ip:${(req.clientIp || ipKeyGenerator(req.ip || "")) ?? "unknown"}`;
    }
    return `account:${identifier}`;
  },
  handler: (_req, _res, __, options) => tooMany(options.limit, options.windowMs),
});

export { authAccountLimiter, authIpLimiter };
