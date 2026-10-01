import { ArrowLeftIcon, LockClosedIcon } from "@heroicons/react/20/solid";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const {
    register,
    verifyEmail,
    resendVerificationCode,
    requestAccountRecovery,
    completeAccountRecovery,
    login,
    isAuthPending,
  } = useAuth();

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
   * True once the user has asked for a code whose purpose is to change an
   * EXISTING account, rather than to finish creating a new one.
   *
   * It changes what the code step does with the digits: `verify-email` merely
   * confirms the address, `recover-account/complete` also applies the password,
   * username and picture the user typed. The flag is deliberately sticky — it
   * survives a trip back to the form, because the code in `code` is only
   * invalidated by the server, never by the client.
   */
  const [recoveryMode, setRecoveryMode] = useState(false);

  /**
   * What the recovery code is about to change, read straight off `values`.
   *
   * Not stashed at request time on purpose: the code only proves inbox
   * ownership, it is not bound to a particular set of details, so a user who
   * changes their mind before typing the digits must not be locked into what
   * they had when they pressed the button. The form is never reset either, so
   * `values` still holds the last thing they typed either way.
   *
   * An empty list is legitimate rather than an error — it is how an abandoned
   * registration is finished without changing anything.
   */
  const pendingChanges = useMemo(() => {
    const changes: string[] = [];
    if (values.password) changes.push("password");
    if (values.username) changes.push("username");
    if (values.avatar) changes.push("picture");
    return changes;
  }, [values.password, values.username, values.avatar]);

  /**
   * "Popup after the user has finished typing the password" — one shot, on
   * the first blur after a pause. Never repeats, and never fires mid-keystroke.
   */
  const passwordToastShown = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The picture input, so a chosen file can be put back the way it was.
   *
   * Needed because a file input cannot be unset by typing: once a picture is
   * chosen there was no way back, which turned the recovery panel's offer to
   * "just confirm the address and change nothing" into a promise the UI could
   * not keep — the picture was already committed to.
   */
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

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
        // A code we already hold was sent to the OLD address, so it is no
        // longer evidence about this one. Staying in recovery mode would let
        // the submit button try to apply it to a different account.
        if (values.email.trim() !== pendingVerification.email) {
          setRecoveryMode(false);
          setCode("");
        }
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

  /**
   * Undo a picture choice.
   *
   * The input's own value is cleared as well as the state, because leaving
   * `File` in the element would let the browser re-populate it on a later form
   * restore and quietly re-apply a picture the user had removed.
   */
  const handleAvatarClear = () => {
    if (avatarInputRef.current) avatarInputRef.current.value = "";
    setValues((prev) => ({ ...prev, avatar: null }));
    applyFieldError("avatar", "");
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
   * Shared by a successful register and the "email me a code" recovery, so both
   * land on the verify step with identical state.
   */
  const enterVerifyStep = (
    masked: string,
    cooldownSeconds: number,
    recovering = false,
  ) => {
    setMaskedEmail(masked);
    setCode("");
    setCodeError("");
    setResendIn(cooldownSeconds);
    setPendingVerification(null);
    setRecoveryMode(recovering);
    setStep("verify");
  };

  // --- Submit ------------------------------------------------------------
  const handleRegister = async () => {
    setSubmitted(true);
    setTouched({ email: true, username: true, password: true, avatar: true });

    /*
     * Already holding a recovery code: apply it, rather than asking the server
     * to create an account we already know exists. `completeRecovery` is
     * defined below this call, but by the time a click arrives it is
     * initialised.
     *
     * This branch deliberately comes BEFORE `validateRegisterForm`, and the
     * order is the whole point. The form's job is no longer "create an
     * account", so the create-account rules no longer describe what the user is
     * trying to do — and running them first refuses the two cases this flow
     * exists for: changing only the picture, and finishing a signup with
     * nothing to change at all. Both are blocked by "Username is required" /
     * "Password is required" on a form that does not need them.
     *
     * Each field is still validated on its own as it is typed and on blur, and
     * the server has the final say on every one of them below.
     */
    if (recoveryMode && code.length === 6) {
      await completeRecovery(values.email.trim(), code);
      return;
    }

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
    setCode("");
    setCodeError("");
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
   * A duplicate address is not only an abandoned signup. It is just as often a
   * working account whose password the user cannot remember — which is why
   * this asks `recover-account` rather than the ordinary resend endpoint. The
   * resend one refuses a confirmed address ("already verified"), so it made
   * the most common version of this dead end: a real account, no way in.
   *
   * The password, username and picture the user has already typed are NOT sent
   * here and are not stashed. The code only proves they can read the inbox;
   * those details are submitted alongside it, and only then applied.
   */
  const handleRecoverWithCode = async () => {
    if (!pendingVerification) return;

    const target = pendingVerification.email;
    const result = await requestAccountRecovery({ email: target });

    if ("message" in result) {
      // Rate limited means a code was already sent inside the cooldown window,
      // so the one already sitting in their inbox is the right one to use. Send
      // them to it rather than leaving them on a dead form.
      if (result.code === "RATE_LIMITED") {
        // The message reads "Please wait 42 seconds before requesting…". Parse
        // the number out of it so the countdown the user sees is the real one
        // rather than a guess. `Number(...)` can never be nullish -- an
        // unmatched string yields NaN, which would survive the `??` and put
        // NaN into the timer -- so the fallback belongs on the match itself.
        const parsed = result.message.match(/(\d+)\s+second/)?.[1];
        const seconds = parsed ? Number(parsed) : RESEND_COOLDOWN_SECONDS;

        enterVerifyStep(maskEmail(target), seconds, true);
        toast.message("We already sent a code to that address", {
          description: "Use the most recent one — we didn't send another.",
        });
        return;
      }

      // Anything else — an unknown address, or the mail provider being down.
      // Stay on the form with the details intact so a second attempt costs
      // them nothing.
      setPendingVerification({
        email: target,
        problem: result.message,
      });
      return;
    }

    enterVerifyStep(
      maskEmail(target),
      result.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS,
      true,
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
    const email = values.email.trim();

    if (recoveryMode) {
      await completeRecovery(email, code);
      return;
    }

    const result = await verifyEmail({ email, code });

    if ("message" in result) {
      // Failed. `requestHandler` already produced a precise message, which
      // includes the remaining-attempt count.
      setCodeError(result.message);
      return;
    }

    toast.success("Email verified — you can log in now.");
    // Hand the address to the login form so they don't retype it.
    LocalStorage.set("prefillEmail", email);
    navigate("/login");
  };

  /**
   * Confirm a recovery code and apply the changed details.
   *
   * Shared by the code step's button and the form's submit button, so a user
   * sent back to fix one field can resubmit without retyping the code.
   */
  const completeRecovery = async (email: string, submittedCode: string) => {
    const result = await completeAccountRecovery({
      email,
      code: submittedCode,
      // Sent only when filled, never as an empty string, so the server can
      // tell "leave this alone" apart from "set this to nothing".
      newPassword: values.password || undefined,
      newUsername: values.username || undefined,
      avatar: values.avatar,
    });

    if ("message" in result) {
      // A complaint about the DETAILS rather than the code. The server
      // deliberately leaves the code valid in that case, so send the user
      // back to the form, error on the offending input, and let them resubmit
      // the same six digits.
      const detailProblem = result.fieldErrors.find((e) =>
        ["username", "password", "avatar"].includes(e.path),
      );

      if (detailProblem) {
        const field = detailProblem.path as RegisterField;
        setTouched((prev) => ({ ...prev, [field]: true }));
        applyFieldError(field, detailProblem.message);
        setStep("form");
        return;
      }

      setCodeError(result.message);
      return;
    }

    // The code proved control of the inbox, which is the one thing this flow
    // could not assume. The user is their own, so send them straight in.
    //
    // Only when the password is one they just chose: otherwise we never knew
    // the account's real password, and guessing would produce a confusing
    // failure in place of a clear "log in" page.
    if (values.password) {
      await login({ username: email, password: values.password });
      return;
    }

    toast.success(
      result.changed.length
        ? "Account updated — log in to continue."
        : "Email confirmed — log in to continue.",
    );
    LocalStorage.set("prefillEmail", email);
    navigate("/login");
  };

  /**
   * Send the code again.
   *
   * In recovery mode this must go to `recover-account`, not to
   * `/resend-verification`. That was the actual dead end in this flow: the
   * account being recovered from is often perfectly healthy, and the resend
   * endpoint answers a confirmed address with "already verified" — so the one
   * user who most needed a new code could never ask for one.
   */
  const handleResend = async () => {
    const email = values.email.trim();
    const result = recoveryMode
      ? await requestAccountRecovery({ email })
      : await resendVerificationCode({ email });

    if ("message" in result) {
      toast.error(result.message);
      return;
    }

    setResendIn(result.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS);
    setCode("");
    setCodeError("");
    toast.success(`New code sent to ${maskedEmail || email}`);
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
            {recoveryMode ? "Confirm it’s you" : "Verify your email"}
          </h1>

          <p className="text-center text-sm font-semibold leading-relaxed text-ink">
            {recoveryMode ? (
              <>
                We sent a 6-digit code to{" "}
                <span className="font-extrabold">
                  {maskedEmail || values.email}
                </span>
                . Enter it and we&apos;ll update that account
                {pendingChanges.length
                  ? ` — changing its ${pendingChanges.join(", ")}.`
                  : "."}
              </>
            ) : (
              <>
                We sent a 6-digit code to{" "}
                <span className="font-extrabold">
                  {maskedEmail || values.email}
                </span>
                . Enter it below to finish setting up your account.
              </>
            )}
            <p className="text-center text-sm font-semibold leading-relaxed text-ink">
              check the <span className="font-extrabold">spam folder </span>
               if you can't find code in inbox.
            </p>
          </p>

          {/* Restating the pending changes here, away from the form: on this
              screen the user has nothing in front of them saying what they
              asked for, and "update that account" is a bigger promise than
              "confirm your email" needs a recap for. */}
          {recoveryMode && pendingChanges.length > 0 ? (
            <ul className="w-full list-inside list-disc bg-cream p-3 text-xs font-bold leading-relaxed text-ink">
              {pendingChanges.map((change) => (
                <li key={change}>Change the {change}</li>
              ))}
            </ul>
          ) : null}

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

          <Button
            fullWidth
            disabled={isAuthPending || code.length !== 6}
            onClick={handleVerify}
          >
            {isAuthPending
              ? "Checking…"
              : recoveryMode
                ? "Confirm and update"
                : "Verify and continue"}
          </Button>

          <button
            type="button"
            onClick={handleResend}
            disabled={isAuthPending || resendIn > 0}
            className="text-xs font-extrabold uppercase tracking-wide text-ink underline underline-offset-4 disabled:cursor-not-allowed disabled:text-ink/40 disabled:no-underline"
          >
            {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
          </button>

          {recoveryMode ? (
            /*
              Back to the fields WITHOUT throwing the code away. The server has
              only validated it, not spent it, so a user who spots a typo in
              the password after entering the code should be able to fix it and
              come straight back rather than wait out the resend cooldown.
              `code` and `recoveryMode` are both preserved, which is also what
              makes the form's submit button apply the change directly.
            */
            <button
              type="button"
              onClick={() => {
                setStep("form");
                setCodeError("");
              }}
              className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-ink underline underline-offset-4"
            >
              <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
              Change my details
            </button>
          ) : (
            /* Back to the form with every field still populated. */
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
          )}
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
            Recovery for the dead end: this address already has an account, so
            submitting the form again can never create one. Shown only on a 409
            against the email field — a username collision has no equivalent,
            because both recovery endpoints key off the address.

            The account may be an abandoned signup or a perfectly healthy one
            whose password has been forgotten, and the same code fixes both,
            which is why the copy promises neither specifically.
          */}
          {pendingVerification ? (
            <div className="neo-sm mt-3 flex flex-col gap-2 bg-cream p-3">
              <p className="text-xs font-bold leading-relaxed text-ink">
                This email already has an account, so this form can&apos;t
                create another. We can email you a code to confirm it&apos;s
                yours — then the details you fill in below replace that
                account&apos;s.
              </p>

              {/* Never a surprise: this is exactly what the code will change. */}
              {pendingChanges.length > 0 ? (
                <ul className="list-inside list-disc text-xs font-bold leading-relaxed text-ink">
                  {pendingChanges.map((change) => (
                    <li key={change}>Change the {change}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs font-bold leading-relaxed text-ink">
                  With those left empty we&apos;ll simply confirm the address
                  and keep the account&apos;s existing details.
                </p>
              )}

              {pendingVerification.problem ? (
                <p className="text-xs font-extrabold leading-relaxed text-retro-red">
                  {pendingVerification.problem}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="small"
                  severity="secondary"
                  disabled={isAuthPending}
                  onClick={handleRecoverWithCode}
                >
                  {isAuthPending ? "Sending…" : "Email me a code"}
                </Button>

                {/* Always offered, because the account may simply be working
                    and the user may not have come here to change it at all —
                    they may have typed a fresh password to replace the old one
                    and then had second thoughts. */}
                <Link
                  to="/login"
                  className="text-[11px] font-extrabold uppercase tracking-wide text-ink underline underline-offset-4"
                >
                  Log in instead
                </Link>

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
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            error={submitted ? errors.avatar : ""}
          />
          {submitted ? <FieldError message={errors.avatar} /> : null}
          {values.avatar ? (
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold text-ink/70">
                Selected: {values.avatar.name}
              </p>
              <button
                type="button"
                onClick={handleAvatarClear}
                className="flex-shrink-0 text-[11px] font-extrabold uppercase tracking-wide text-ink underline underline-offset-4"
              >
                Remove
              </button>
            </div>
          ) : null}
        </div>

        <Button fullWidth disabled={isAuthPending} onClick={handleRegister}>
          {isAuthPending
            ? "Creating your account…"
            : // Back on the form holding a recovery code: the account exists,
              // so "Register" would be a lie that only produces a 409.
              recoveryMode && code.length === 6
              ? "Confirm and update"
              : "Register"}
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
