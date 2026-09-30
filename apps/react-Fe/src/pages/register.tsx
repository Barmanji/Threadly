import { ArrowLeftIcon, LockClosedIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Button from "../components/Button";
import { FieldError, PasswordRuleList } from "../components/FieldError";
import Input from "../components/Input";
import OtpInput from "../components/OtpInput";
import ThemeToggle from "../components/ThemeToggle";
import ChangelogLink from "../components/ChangelogLink";
import { useAuth } from "../context/AuthContext";
import {
    LocalStorage,
    maskEmail,
    type ApiFailure,
} from "../utils";
import {
  EMPTY_REGISTER_ERRORS,
  PASSWORD_RULES,
  PASSWORD_RULES_SUMMARY,
  checkPasswordRules,
  validateRegisterField,
  validateRegisterForm,
  type RegisterErrors,
  type RegisterField,
  type RegisterValues,
} from "../utils/validation";

const RESEND_COOLDOWN_SECONDS = 60;

const Register = () => {
  const navigate = useNavigate();
  const { register, verifyEmail, resendVerificationCode, isAuthPending } =
    useAuth();

  /**
   * Single source of truth for the form, and deliberately NEVER reset by an
   * error. Whatever the user typed survives a failed submit so they can read
   * the message and correct that one field.
   */
  const [values, setValues] = useState<RegisterValues>({
    email: "",
    username: "",
    password: "",
    avatar: null,
  });

  const [errors, setErrors] = useState<RegisterErrors>(EMPTY_REGISTER_ERRORS);

  /**
   * Fields the user has actually interacted with. Live validation only speaks
   * up for touched fields, so an untouched empty form isn't a wall of red.
   */
  const [touched, setTouched] = useState<
    Partial<Record<RegisterField, boolean>>
  >({});

  /** Set on the first submit; from then on every known error is shown. */
  const [submitted, setSubmitted] = useState(false);

  /** Which of the password rules the current value satisfies. */
  const passwordRuleResults = checkPasswordRules(values.password);

  // --- Verification step -------------------------------------------------
  const [step, setStep] = useState<"form" | "verify">("form");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState<number | null>(null);
  const [maxAttempts, setMaxAttempts] = useState(5);
  const [maskedEmail, setMaskedEmail] = useState("");
  const [resendIn, setResendIn] = useState(0);

  /**
   * Set when the server rejects the email as already registered, which is
   * also what happens when the account exists but was never verified — the
   * case where this form can no longer get the user a code, because a
   * duplicate is a duplicate whether or not it has been proven yet.
   *
   * `problem` carries whatever the resend attempt answered with, so a real
   * account ("already verified") can say so next to a login link instead of
   * silently doing nothing.
   */
  const [pendingVerification, setPendingVerification] = useState<{
    email: string;
    problem?: string;
  } | null>(null);

  /**
   * "Popup after the user has finished typing the password" — one shot, on
   * the first blur after a pause. Never repeats, and never fires mid-keystroke.
   */
  const passwordToastShown = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    };
  }, []);

  // --- Field handling ----------------------------------------------------
  const applyFieldError = (field: RegisterField, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }));
  };

  const markTouched = (field: RegisterField) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    applyFieldError(field, validateRegisterField(field, values));
  };

  const handleTextChange =
    (field: "email" | "username" | "password") =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next: RegisterValues = { ...values, [field]: e.target.value };
      setValues(next);

      // The recovery panel is pinned to one address; changing the address
      // invalidates it.
      if (field === "email" && pendingVerification) {
        setPendingVerification(null);
      }

      // Real-time: re-validate as they type, as soon as the field has
      // content. Empty means "not typed yet", not "wrong".
      if (touched[field] || e.target.value.length > 0) {
        setTouched((prev) => ({ ...prev, [field]: true }));
        applyFieldError(field, validateRegisterField(field, next));
      }
    };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next: RegisterValues = {
      ...values,
      avatar: e.target.files?.[0] || null,
    };
    setValues(next);
    setTouched((prev) => ({ ...prev, avatar: true }));
    applyFieldError("avatar", validateRegisterField("avatar", next));
  };

  const handlePasswordBlur = () => {
    markTouched("password");
    if (blurTimer.current) clearTimeout(blurTimer.current);

    // Let them finish the thought, then surface a single summary toast.
    blurTimer.current = setTimeout(() => {
      if (passwordToastShown.current) return;
      if (validateRegisterField("password", values)) {
        passwordToastShown.current = true;
        toast.error("Password doesn't meet the rules yet", {
          description: PASSWORD_RULES_SUMMARY,
          duration: 6000,
        });
      }
    }, 900);
  };

  /**
   * Push a server-side failure onto the right input. Falls back to a toast
   * when the problem isn't tied to a specific field (e.g. a Cloudinary
   * outage), so the user always finds out what happened.
   */
  const applyApiFailure = (failure: ApiFailure) => {
    const fieldError = failure.fieldErrors.find((e) =>
      ["email", "username", "password", "avatar"].includes(e.path),
    );

    if (fieldError) {
      setTouched((prev) => ({
        ...prev,
        [fieldError.path as RegisterField]: true,
      }));
      applyFieldError(fieldError.path as RegisterField, fieldError.message);

      // A 409 on the email is ambiguous: the address may belong to a live
      // account, or to a half-finished registration whose code was never
      // entered. The second is the one that dead-ends, because the register
      // endpoint refuses it just the same. So offer the one request that
      // can still make progress — ask for a fresh code. The resend endpoint
      // answers "already verified" if the account is real, which is the
      // honest answer and needs no new server code to give.
      const isUnverifiableEmail =
        fieldError.path === "email" && failure.statusCode === 409;

      setPendingVerification(
        isUnverifiableEmail
          ? { email: values.email.trim() }
          : null,
      );

      return;
    }

    setPendingVerification(null);
    toast.error(failure.message);
  };

  /**
   * Shared by a successful register and the "email me a new code" recovery,
   * so both land on the verify step with identical state.
   */
  const enterVerifyStep = (
    masked: string,
    cooldownSeconds: number,
    attempts: number | null,
  ) => {
    setMaskedEmail(masked);
    if (attempts !== null) setMaxAttempts(attempts);
    setCode("");
    setCodeError("");
    setAttemptsLeft(null);
    setResendIn(cooldownSeconds);
    setPendingVerification(null);
    setStep("verify");
  };

  // --- Submit ------------------------------------------------------------
  const handleRegister = async () => {
    setSubmitted(true);
    setTouched({ email: true, username: true, password: true, avatar: true });

    const nextErrors = validateRegisterForm(values);
    setErrors(nextErrors);

    // Blocked on real-time feedback rather than a silent no-op, and the values
    // are left exactly as typed so the user can fix each field in place.
    if (Object.values(nextErrors).some(Boolean)) return;

    const outcome = await register(values);

    if (!outcome) return;

    if (!outcome.ok) {
      applyApiFailure(outcome.failure);
      return;
    }

    setMaskedEmail(outcome.data.email);
    setMaxAttempts(outcome.data.maxAttempts ?? 5);
    setCode("");
    setCodeError("");
    setAttemptsLeft(null);
    setResendIn(RESEND_COOLDOWN_SECONDS);
    setPendingVerification(null);
    setStep("verify");

    if (outcome.data.emailSent) {
      toast.success(`Verification code sent to ${outcome.data.email}`);
    } else {
      toast.error("We couldn't send the email. Use “Resend code” below.");
    }
  };

  /**
   * Ask for a code for an address the register endpoint already refused.
   *
   * The user reached the code step, decided not to enter it, came back and
   * filled the same form in again. The account exists, so the form is a dead
   * end — but the account is also unverified, so a code is still the thing
   * they need, and the public resend endpoint will issue one.
   */
  const handleRecoverWithCode = async () => {
    if (!pendingVerification) return;

    const target = pendingVerification.email;
    const result = await resendVerificationCode({ email: target });

    if ("message" in result) {
      // Rate limited means a code was already sent inside the cooldown
      // window, so the one already sitting in their inbox is the right one
      // to use. Send them to it rather than leaving them on a dead form.
      if (result.code === "RATE_LIMITED") {
        // The message reads "Please wait 42 seconds before requesting…". Parse
        // the number out of it so the countdown the user sees is the real one
        // rather than a guess. `Number(...)` can never be nullish -- an
        // unmatched string yields NaN, which would survive the `??` and put
        // NaN into the timer -- so the fallback belongs on the match itself.
        const parsed = result.message.match(/(\d+)\s+second/)?.[1];
        const seconds = parsed ? Number(parsed) : RESEND_COOLDOWN_SECONDS;

        enterVerifyStep(maskEmail(target), seconds, null);
        toast.message("We already sent a code to that address", {
          description: "Use the most recent one — we didn't send another.",
        });
        return;
      }

      // Anything else — "This email address is already verified." above all —
      // means this is a real account and login is the way in.
      setPendingVerification({
        email: target,
        problem: result.message,
      });
      return;
    }

    enterVerifyStep(
      maskEmail(target),
      result.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS,
      result.maxAttempts,
    );

    toast.success(`New code sent to ${maskEmail(target)}`);
  };

  // --- Verification ------------------------------------------------------
  const handleVerify = async () => {
    if (code.length !== 6) {
      setCodeError("Enter the 6-digit code from your email.");
      return;
    }

    setCodeError("");
    const result = await verifyEmail({ email: values.email.trim(), code });

    if ("message" in result) {
      // Failed. `requestHandler` already produced a precise message, which
      // includes the remaining-attempt count.
      setCodeError(result.message);

      // Pull "N attempts left" out of the field error so the counter is
      // driven by the server rather than guessed at on the client.
      const match = result.message.match(/(\d+)\s+attempt/i);
      if (match) setAttemptsLeft(Number(match[1]));
      else if (/all \d+ attempts|no attempts/i.test(result.message))
        setAttemptsLeft(0);
      return;
    }

    toast.success("Email verified — you can log in now.");
    // Hand the address to the login form so they don't retype it.
    LocalStorage.set("prefillEmail", values.email.trim());
    navigate("/login");
  };

  const handleResend = async () => {
    const result = await resendVerificationCode({ email: values.email.trim() });

    if ("message" in result) {
      toast.error(result.message);
      return;
    }

    setResendIn(result.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS);
    setCode("");
    setCodeError("");
    setAttemptsLeft(null);
    toast.success(`New code sent to ${maskedEmail || values.email.trim()}`);
  };

  // --- Render ------------------------------------------------------------
  if (step === "verify") {
    return (
      <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-doodle bg-doodle-scroll px-4 py-10">
        <div className="absolute right-4 top-4 z-20 flex items-center gap-3">
          <ChangelogLink size="md" />
          <ThemeToggle />
        </div>
        <h1 className="neo rotate-[2deg] bg-retro-yellow px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink">
          Threadly
        </h1>

        <div className="neo my-8 flex w-full max-w-md flex-col items-center gap-5 bg-retro-orange p-8">
          <h1 className="neo-sm flex flex-col items-center bg-cream px-6 py-2 text-center text-2xl">
            <LockClosedIcon className="mb-2 h-8 w-8 text-retro-orange" />
            Verify your email
          </h1>

          <p className="text-center text-sm font-semibold leading-relaxed text-ink">
            We sent a 6-digit code to{" "}
            <span className="font-extrabold">
              {maskedEmail || values.email}
            </span>
            . Enter it below to finish setting up your account.
            <p className="text-center text-sm font-semibold leading-relaxed text-ink">
              check the <span className="font-extrabold">spam folder </span>
               if you can't find code in inbox.
            </p>
          </p>

          <OtpInput
            value={code}
            onChange={(next) => {
              setCode(next);
              if (codeError) setCodeError("");
            }}
            disabled={isAuthPending}
            invalid={Boolean(codeError)}
          />

          <FieldError message={codeError} />

          {attemptsLeft !== null ? (
            <p
              className={
                attemptsLeft > 0
                  ? "text-center text-xs font-bold text-ink"
                  : "text-center text-xs font-extrabold text-retro-red"
              }
              role="status"
            >
              {attemptsLeft > 0
                ? `${attemptsLeft} of ${maxAttempts} attempts left.`
                : "You've used all your attempts. Request a new code below."}
            </p>
          ) : null}

          <Button
            fullWidth
            disabled={isAuthPending || code.length !== 6}
            onClick={handleVerify}
          >
            {isAuthPending ? "Verifying…" : "Verify and continue"}
          </Button>

          <button
            type="button"
            onClick={handleResend}
            disabled={isAuthPending || resendIn > 0}
            className="text-xs font-extrabold uppercase tracking-wide text-ink underline underline-offset-4 disabled:cursor-not-allowed disabled:text-ink/40 disabled:no-underline"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>

          {/* Back to the form with every field still populated. */}
          <button
            type="button"
            onClick={() => {
              setStep("form");
              setCodeError("");
            }}
            className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-ink underline underline-offset-4"
          >
            <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  const showPasswordChecklist = values.password.length > 0;

  return (
    <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-doodle bg-doodle-scroll px-4 py-10">
      <div className="absolute right-4 top-4 z-20 flex items-center gap-3">
        <ChangelogLink size="md" />
        <ThemeToggle />
      </div>
      <h1 className="neo rotate-[2deg] bg-retro-yellow px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink">
        Threadly
      </h1>

      <div className="neo my-8 flex w-full max-w-md flex-col items-center gap-4 bg-retro-orange p-8">
        <h1 className="neo-sm flex flex-col items-center bg-cream px-6 py-2 text-2xl">
          <LockClosedIcon className="mb-2 h-8 w-8 text-retro-orange" /> Register
        </h1>

        <div className="w-full">
          <label
            htmlFor="register-email"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Email
          </label>
          <Input
            id="register-email"
            placeholder="Enter the email..."
            type="email"
            value={values.email}
            onChange={handleTextChange("email")}
            onBlur={() => markTouched("email")}
            error={touched.email ? errors.email : ""}
          />
          <FieldError message={touched.email ? errors.email : ""} />

          {/*
            Recovery for the dead end: this address already has an account,
            so submitting the form again can never produce a code. Shown only
            on a 409 against the email field — a username collision has no
            equivalent, because the resend endpoint keys off the address.
          */}
          {pendingVerification ? (
            <div className="neo-sm mt-3 flex flex-col gap-2 bg-cream p-3">
              <p className="text-xs font-bold leading-relaxed text-ink">
                This email already has an account. If it was never
                verified, we can send a fresh code — no need to fill
                the form in again.
              </p>

              {pendingVerification.problem ? (
                <p className="text-xs font-extrabold leading-relaxed text-retro-red">
                  {pendingVerification.problem}{" "}
                  <Link to="/login" className="neo-sm bg-retro-yellow px-1">
                    Log in
                  </Link>
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="small"
                  severity="secondary"
                  disabled={isAuthPending}
                  onClick={handleRecoverWithCode}
                >
                  {isAuthPending
                    ? "Sending…"
                    : "Email me a new code"}
                </Button>
                <button
                  type="button"
                  onClick={() =>
                    setPendingVerification(null)
                  }
                  className="text-[11px] font-extrabold uppercase tracking-wide text-ink underline underline-offset-4"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="w-full">
          <label
            htmlFor="register-username"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Username
          </label>
          <Input
            id="register-username"
            placeholder="Enter the username..."
            value={values.username}
            onChange={handleTextChange("username")}
            onBlur={() => markTouched("username")}
            error={touched.username ? errors.username : ""}
          />
          <FieldError message={touched.username ? errors.username : ""} />
        </div>

        <div className="w-full">
          <label
            htmlFor="register-password"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Password
          </label>
          <Input
            id="register-password"
            placeholder="Enter the password..."
            isPassword
            value={values.password}
            onChange={handleTextChange("password")}
            onBlur={handlePasswordBlur}
            error={submitted ? errors.password : ""}
          />
          {/* The live checklist is the primary affordance. The single error
              line only appears after an actual submit attempt, so it never
              duplicates what the checklist is already showing. */}
          <PasswordRuleList
            visible={showPasswordChecklist}
            results={passwordRuleResults}
            rules={PASSWORD_RULES}
            summary={PASSWORD_RULES_SUMMARY}
          />
          {submitted ? <FieldError message={errors.password} /> : null}
        </div>

        <div className="w-full">
          <label
            htmlFor="register-avatar"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Profile picture
          </label>
          <Input
            id="register-avatar"
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            error={submitted ? errors.avatar : ""}
          />
          {submitted ? <FieldError message={errors.avatar} /> : null}
          {values.avatar ? (
            <p className="mt-1.5 text-[11px] font-semibold text-ink/70">
              Selected: {values.avatar.name}
            </p>
          ) : null}
        </div>

        <Button fullWidth disabled={isAuthPending} onClick={handleRegister}>
          {isAuthPending ? "Creating your account…" : "Register"}
        </Button>

        <small className="font-bold text-ink">
          Already have an account?{" "}
          <Link to="/login" className="neo-sm bg-retro-yellow px-1">
            Login
          </Link>
        </small>
      </div>
    </div>
  );
};

export default Register;
