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
 *
 * `allowVerified` exists for the account-recovery path. Ordinary verification
 * has nothing to do once the address is confirmed, and refusing to send keeps
 * that endpoint from being a password-reset oracle. Recovery is different: the
 * code is being used to prove control of the inbox before changing credentials,
 * which a confirmed address has just as much need for as an unconfirmed one.
 */
export const issueVerificationCode = async (
  userId: string,
  email: string,
  username: string,
  { allowVerified = false }: { allowVerified?: boolean } = {},
): Promise<IssuedCodeResult> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "That account no longer exists.");
  }

  // Already verified — nothing to do, and don't burn a send.
  if (user.isEmailVerified && !allowVerified) {
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

/** The subset of the user document the code check needs. */
type UserForCodeCheck = InstanceType<typeof User>;

/**
 * Check a submitted code against the stored hash.
 *
 * Deliberately does NOT mutate on success — the caller decides what a valid
 * code entitles the caller to, and how to commit it. The account-recovery path
 * needs that: it has to check the code and then still be able to fail on a
 * taken username or a Cloudinary error, and it must not have burned the code
 * if it does.
 *
 * Failures DO mutate, because the attempt counter is the thing limiting
 * brute-force guessing and it has to advance no matter who is calling.
 *
 * Throws a descriptive `ApiError` on every failure path. The client uses
 * `attemptsRemaining` to tell the user exactly how many tries they have left.
 */
const checkPendingCode = async (
  user: UserForCodeCheck,
  code: string,
): Promise<VerifyCodeResult> => {
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

  return {
    attemptsRemaining: EMAIL_VERIFICATION_MAX_ATTEMPTS,
    attemptsUsed: verification.attempts ?? 0,
  };
};

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

  const result = await checkPendingCode(user, code);

  // Correct code.
  user.isEmailVerified = true;
  // Clear the sub-document entirely — the code has served its purpose and
  // there's no reason to keep a hash of it around.
  user.emailVerification = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info(`[email-verification] verified ${maskEmail(user.email)}`);

  return result;
};

/**
 * Check a recovery code WITHOUT consuming it.
 *
 * Same security gate as `verifyEmailCode` — a code from the inbox, the same
 * expiry, the same five attempts — but it leaves the pending code in place so
 * the caller can still reject a bad username or a failed upload without the
 * user having to ask for another email. It also does not treat an
 * already-verified account as an automatic pass, which is the whole point:
 * that is the forgot-password case.
 *
 * The returned `user` is a live document the caller is expected to mutate and
 * save exactly once.
 */
export const checkRecoveryCode = async (
  email: string,
  code: string,
): Promise<{ user: UserForCodeCheck; attemptsRemaining: number; attemptsUsed: number }> => {
  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Identical to a wrong code, so a caller cannot use this to discover which
  // addresses have accounts.
  if (!user) {
    throw new ApiError(
      400,
      "That code isn't right. Check it and try again.",
      [{ path: "code", message: "That code isn't right. Check it and try again." }],
      "VERIFICATION_CODE_INVALID",
    );
  }

  const result = await checkPendingCode(user, code);
  return { user, ...result };
};

