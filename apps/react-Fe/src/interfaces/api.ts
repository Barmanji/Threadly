import type { UserInterface } from "./user";

export interface FreeAPISuccessResponseInterface<T = unknown> {
  data: T;
  message: string;
  statusCode: number;
  success: boolean;
  /** Machine-readable failure code, mirrors the backend `ApiErrorCode`. */
  code?: string;
  /** Field-level problems, each mapped back onto a form input. */
  errors?: ApiFieldErrorInterface[];
}

export interface ApiFieldErrorInterface {
  path: string;
  message: string;
}

export interface LoginResponseData {
  accessToken: string;
  refreshToken?: string;
  findUser: UserInterface;
}

/** What `POST /user/register` returns now that verification is required. */
export interface RegisterResultData {
  requiresEmailVerification: boolean;
  /** Masked address — the server never echoes the full one back. */
  email: string;
  expiresInSeconds: number;
  maxAttempts: number;
  /** False when the code couldn't be dispatched; offer a resend. */
  emailSent: boolean;
}

export interface VerifyEmailResultData {
  verified: boolean;
  attemptsRemaining: number;
  attemptsUsed: number;
}

export interface ResendCodeResultData {
  emailSent: boolean;
  expiresInSeconds: number;
  maxAttempts: number;
  cooldownSeconds: number;
}

/**
 * What `POST /user/recover-account` returns.
 *
 * `accountVerified` tells the caller which case it is, so the form can explain
 * itself rather than showing the same copy for both — an abandoned signup and a
 * real forgotten password are the same request but very different situations.
 */
export interface RecoveryCodeResultData extends ResendCodeResultData {
  accountVerified: boolean;
}

/** What `POST /user/recover-account/complete` returns. */
export interface CompleteRecoveryResultData {
  /** Which of password / username / avatar were actually applied. */
  changed: string[];
  /** Masked — the server never echoes the full address back. */
  email: string;
  username: string;
  /** Same shape as /verify-email, so the client runs one code path. */
  attemptsRemaining: number;
  attemptsUsed: number;
}