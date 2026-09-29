import { Resend } from "resend";
import logger from "../logger/winston.logger.js";

/**
 * Transactional email via Resend.
 *
 * The verified sending domain is `barmanji.com`; the `from` address must live
 * on a domain verified in the Resend dashboard or every send is rejected.
 */

const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "Threadly <noreply@barmanji.com>";

let client: Resend | null = null;

const getClient = (): Resend | null => {
  if (client) return client;
  const apiKey = process.env.RESEND_API;
  if (!apiKey) {
    logger.error(
      "RESEND_API is not set. Verification emails cannot be sent — check the backend .env.",
    );
    return null;
  }
  client = new Resend(apiKey);
  return client;
};

/** Escape user-controlled text before it goes anywhere near HTML. */
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const emailShell = (heading: string, body: string): string => `
  <div style="font-family: Archivo, -apple-system, Segoe UI, sans-serif; background:#efe3ca; padding:32px 16px;">
    <div style="max-width:480px; margin:0 auto; background:#fff8e1; border:3px solid #1b1b1b; box-shadow:5px 5px 0 0 #1b1b1b; padding:28px;">
      <h1 style="margin:0 0 4px; font-size:22px; letter-spacing:-0.02em; color:#1b1b1b;">Threadly</h1>
      <p style="margin:0 0 24px; font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:#ff6b35;">${heading}</p>
      ${body}
      <p style="margin:28px 0 0; font-size:12px; line-height:1.6; color:#1b1b1b; opacity:0.6;">
        If you didn't ask for this, you can safely ignore this email.
      </p>
    </div>
  </div>`;

/**
 * Send the 6-digit account verification code.
 *
 * Returns `true` on success and `false` on failure — deliberately not
 * throwing. Registration has already created the account by this point, so
 * failing the whole request would leave the user locked out of an account
 * that exists. A `false` return lets the API tell the client the code wasn't
 * sent so it can offer a resend.
 */
export const sendVerificationCodeEmail = async (
  to: string,
  code: string,
  username: string,
): Promise<boolean> => {
  const resend = getClient();
  if (!resend) return false;

  const body = emailShell(
    "Verify your email",
    `
      <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:#1b1b1b;">
        Hi ${escapeHtml(username)}, enter this code to finish setting up your account.
      </p>
      <div style="font-size:34px; font-weight:800; letter-spacing:0.28em; text-align:center; background:#ffd23f; border:3px solid #1b1b1b; padding:18px 8px 18px 0.28em; margin:0 0 20px;">
        ${escapeHtml(code)}
      </div>
      <p style="margin:0; font-size:13px; line-height:1.6; color:#1b1b1b; opacity:0.75;">
        This code expires in 10 minutes. If it expires, request a new one from the verification screen.
      </p>`,
  );

  try {
    const { error } = await resend.emails.send({
      from: RESEND_FROM,
      to,
      subject: `${code} is your Threadly verification code`,
      html: body,
      text: `Hi ${username}, your Threadly verification code is ${code}. It expires in 10 minutes.`,
    });

    if (error) {
      logger.error(`Resend rejected the verification email: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    logger.error(
      `Failed to send verification email: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return false;
  }
};

/** Exposed for tests / diagnostics. */
export const isEmailConfigured = (): boolean => Boolean(process.env.RESEND_API);
