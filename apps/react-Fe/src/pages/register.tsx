import { ArrowLeftIcon, LockClosedIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import Button from "../components/Button";
import { FieldError, PasswordRuleList } from "../components/FieldError";
import Input from "../components/Input";
import OtpInput from "../components/OtpInput";
import ThemeToggle from "../components/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { LocalStorage, type ApiFailure } from "../utils";
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
  const { register, verifyEmail, resendVerificationCode, isAuthPending } = useAuth();

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
  const [touched, setTouched] = useState<Partial<Record<RegisterField, boolean>>>({});

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

      // Real-time: re-validate as they type, as soon as the field has
      // content. Empty means "not typed yet", not "wrong".
      if (touched[field] || e.target.value.length > 0) {
        setTouched((prev) => ({ ...prev, [field]: true }));
        applyFieldError(field, validateRegisterField(field, next));
      }
    };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next: RegisterValues = { ...values, avatar: e.target.files?.[0] || null };
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
      setTouched((prev) => ({ ...prev, [fieldError.path as RegisterField]: true }));
      applyFieldError(fieldError.path as RegisterField, fieldError.message);
      return;
    }

    toast.error(failure.message);
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
    setStep("verify");

    if (outcome.data.emailSent) {
      toast.success(`Verification code sent to ${outcome.data.email}`);
    } else {
      toast.error("We couldn't send the email. Use “Resend code” below.");
    }
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
      else if (/all \d+ attempts|no attempts/i.test(result.message)) setAttemptsLeft(0);
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
      <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-cream px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
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
            <span className="font-extrabold">{maskedEmail || values.email}</span>.
            Enter it below to finish setting up your account.
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
    <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-cream px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
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
