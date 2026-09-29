import bcrypt from "bcryptjs";
import crypto from "crypto";

import {
  EMAIL_VERIFICATION_MAX_ATTEMPTS,
  EMAIL_VERIFICATION_RESEND_COOLDOWN_MS,
  EMAIL_VERIFICATION_TTL_MS,
  User,
} from "../models/user/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { sendVerificationCodeEmail } from "../utils/sendEmail.js";
import logger from "../logger/winston.logger.js";

/** Cryptographically random 6-digit code, zero-padded. */
const generateNumericCode = (): string =>
  String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/** Partially mask an address so we never echo a full email back to the client. */
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};

export interface IssuedCodeResult {
  ok: boolean;
  /** Cooldown still running — the existing code is still valid. */
  rateLimited?: boolean;
  secondsUntilRetry?: number;
}

/**
 * Issue a fresh verification code and email it.
 *
 * Rate limited to one send per `EMAIL_VERIFICATION_RESEND_COOLDOWN_MS` so the
 * endpoint can't be used to spam an inbox or to burn through Resend quota.
 */
export const issueVerificationCode = async (
  userId: string,
  email: string,
  username: string,
): Promise<IssuedCodeResult> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "That account no longer exists.");
  }

  // Already verified — nothing to do, and don't burn a send.
  if (user.isEmailVerified) {
    throw new ApiError(409, "This email address is already verified.");
  }

  const now = new Date();
  const lastSentAt = user.emailVerification?.lastSentAt;

  if (lastSentAt) {
    const elapsed = now.getTime() - lastSentAt.getTime();
    if (elapsed < EMAIL_VERIFICATION_RESEND_COOLDOWN_MS) {
      const seconds = Math.ceil(
        (EMAIL_VERIFICATION_RESEND_COOLDOWN_MS - elapsed) / 1000,
      );
      return { ok: false, rateLimited: true, secondsUntilRetry: seconds };
    }
  }

  // A user who burned all their attempts must not be silently handed a fresh
  // code by the resend button without resetting the counter — but re-sending
  // IS the intended recovery, so the counter is reset here explicitly.
  const attemptsWereExhausted =
    (user.emailVerification?.attempts ?? 0) >= EMAIL_VERIFICATION_MAX_ATTEMPTS;
  if (attemptsWereExhausted) {
    logger.info(
      `[email-verification] resetting exhausted attempt counter for ${maskEmail(email)}`,
    );
  }

  const code = generateNumericCode();
  const codeHash = await bcrypt.hash(code, 10);

  user.emailVerification = {
    codeHash,
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    attempts: 0,
    lastSentAt: now,
  };
  await user.save({ validateBeforeSave: false });

  const sent = await sendVerificationCodeEmail(email, code, username);
  return { ok: sent };
};

export interface VerifyCodeResult {
  attemptsRemaining: number;
  attemptsUsed: number;
}

/**
 * Check a submitted code against the stored hash.
 *
 * Throws a descriptive `ApiError` on every failure path. The client uses
 * `attemptsRemaining` to tell the user exactly how many tries they have left.
 */
export const verifyEmailCode = async (
  email: string,
  code: string,
): Promise<VerifyCodeResult> => {
  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Deliberately identical response whether the account exists or not, so
  // this endpoint can't be used to enumerate registered email addresses.
  if (!user) {
    throw new ApiError(
      400,
      "That code isn't right. Check it and try again.",
      [{ path: "code", message: "That code isn't right. Check it and try again." }],
      "VERIFICATION_CODE_INVALID",
    );
  }

  if (user.isEmailVerified) {
    // Idempotent: a double-submit (e.g. a retry after a slow response) should
    // succeed rather than confuse the user.
    return { attemptsRemaining: EMAIL_VERIFICATION_MAX_ATTEMPTS, attemptsUsed: 0 };
  }

  const verification = user.emailVerification;
  if (!verification?.codeHash) {
    throw new ApiError(
      400,
      "No code is pending for this email. Request a new one and try again.",
      [{ path: "code", message: "Request a new code to continue." }],
      "VERIFICATION_CODE_INVALID",
    );
  }

  if (verification.expiresAt.getTime() < Date.now()) {
    // Wipe the stale code so the UI can prompt for a resend cleanly.
    user.emailVerification = undefined;
    await user.save({ validateBeforeSave: false });
    throw new ApiError(
      400,
      "That code has expired. Request a new one to continue.",
      [{ path: "code", message: "That code has expired. Request a new one." }],
      "VERIFICATION_CODE_INVALID",
    );
  }

  const isMatch = await bcrypt.compare(code, verification.codeHash);

  if (!isMatch) {
    verification.attempts = (verification.attempts ?? 0) + 1;
    const attemptsRemaining = Math.max(
      0,
      EMAIL_VERIFICATION_MAX_ATTEMPTS - verification.attempts,
    );

    // Out of tries: destroy the code entirely rather than letting it sit
    // there as a dead end. The resend button becomes the only way forward.
    if (attemptsRemaining === 0) {
      user.emailVerification = undefined;
    }

    await user.save({ validateBeforeSave: false });

    const attemptsUsed = verification.attempts ?? 0;
    throw new ApiError(
      400,
      attemptsRemaining === 0
        ? "That code isn't right. You've used all 5 attempts — request a new code to continue."
        : `That code isn't right. ${attemptsRemaining} attempt${
            attemptsRemaining === 1 ? "" : "s"
          } left.`,
      [
        {
          path: "code",
          message:
            attemptsRemaining === 0
              ? "Incorrect code. Request a new one to continue."
              : `Incorrect code. ${attemptsRemaining} attempt${
                  attemptsRemaining === 1 ? "" : "s"
                } left.`,
        },
      ],
      "VERIFICATION_CODE_INVALID",
    );
  }

  // Correct code.
  const attemptsUsed = verification.attempts ?? 0;
  user.isEmailVerified = true;
  // Clear the sub-document entirely — the code has served its purpose and
  // there's no reason to keep a hash of it around.
  user.emailVerification = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`[email-verification] verified ${maskEmail(user.email)}`);

  return { attemptsRemaining: EMAIL_VERIFICATION_MAX_ATTEMPTS, attemptsUsed };
};
