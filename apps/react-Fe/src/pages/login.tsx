import { LockClosedIcon } from "@heroicons/react/20/solid";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import Button from "../components/Button";
import { FieldError } from "../components/FieldError";
import Input from "../components/Input";
import ThemeToggle from "../components/ThemeToggle";
import { useAuth } from "../context/AuthContext";
import { LocalStorage } from "../utils";
import { validateEmail } from "../utils/validation";

// Component for the Login page
const Login = () => {
  const [data, setData] = useState({
    username: "",
    password: "",
  });

  const { login, resendVerificationCode, isAuthPending } = useAuth();

  const [errors, setErrors] = useState({ username: "", password: "" });
  const [touched, setTouched] = useState<{ username?: boolean; password?: boolean }>({});
  const [formError, setFormError] = useState("");

  /**
   * Set when login is rejected with EMAIL_NOT_VERIFIED. The user then gets an
   * inline "resend the code" affordance right here, so an account abandoned
   * mid-verification is never a dead end.
   */
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  // Carry the address over from the register page so they don't retype it.
  useEffect(() => {
    const prefill = LocalStorage.get<string>("prefillEmail");
    if (prefill) {
      setData((prev) => ({ ...prev, username: prefill }));
      LocalStorage.remove("prefillEmail");
    }
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const handleDataChange =
    (name: "username" | "password") => (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setData((prev) => ({ ...prev, [name]: value }));
      setFormError("");

      if (touched[name] || value.length > 0) {
        setTouched((prev) => ({ ...prev, [name]: true }));
        setErrors((prev) => ({ ...prev, [name]: validateField(name, value) }));
      }
    };

  const validateField = (name: "username" | "password", value: string): string => {
    if (!value.trim()) return name === "username" ? "Enter your username or email." : "Enter your password.";
    // Only validate the format when it actually looks like an email address;
    // this field also accepts a plain username.
    if (name === "username" && value.includes("@")) {
      return validateEmail(value).message;
    }
    return "";
  };

  const markTouched = (name: "username" | "password") => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    setErrors((prev) => ({ ...prev, [name]: validateField(name, data[name]) }));
  };

  const handleLogin = async () => {
    setTouched({ username: true, password: true });
    setFormError("");
    setUnverifiedEmail(null);

    const nextErrors = {
      username: validateField("username", data.username),
      password: validateField("password", data.password),
    };
    setErrors(nextErrors);

    // Values are never cleared on a failed attempt.
    if (Object.values(nextErrors).some(Boolean)) return;

    const failure = await login(data);
    if (!failure) return; // success — the context already navigated

    setFormError(failure.message);

    if (failure.code === "EMAIL_NOT_VERIFIED") {
      // The user typed an email address, so we know where to send the code.
      setUnverifiedEmail(data.username.includes("@") ? data.username : null);
    }
  };

  const handleResend = async () => {
    if (!unverifiedEmail) return;
    const result = await resendVerificationCode({ email: unverifiedEmail });
    if ("message" in result) {
      toast.error(result.message);
      return;
    }
    setResendIn(result.cooldownSeconds ?? 60);
    toast.success(`New verification code sent to ${unverifiedEmail}`);
  };

  return (
    <div className="relative flex h-dvh w-full flex-col items-center justify-center overflow-y-auto bg-doodle bg-doodle-scroll px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <h1 className="neo rotate-[-2deg] bg-retro-yellow px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink">
        Threadly
      </h1>

      <div className="neo my-8 flex w-full max-w-md flex-col items-center gap-4 bg-retro-orange p-8">
        <h1 className="neo-sm flex flex-col items-center bg-cream px-6 py-2 text-2xl">
          <LockClosedIcon className="mb-2 h-8 w-8 text-retro-orange" /> Login
        </h1>

        {formError ? (
          <div
            role="alert"
            className="w-full border-2 border-retro-red bg-retro-red/10 p-3 text-xs font-semibold text-ink"
          >
            {formError}
          </div>
        ) : null}

        <div className="w-full">
          <label
            htmlFor="login-username"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Username or email
          </label>
          <Input
            id="login-username"
            placeholder="Enter the username..."
            value={data.username}
            onChange={handleDataChange("username")}
            onBlur={() => markTouched("username")}
            error={touched.username ? errors.username : ""}
          />
          <FieldError message={touched.username ? errors.username : ""} />
        </div>

        <div className="w-full">
          <label
            htmlFor="login-password"
            className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-ink"
          >
            Password
          </label>
          <Input
            id="login-password"
            placeholder="Enter the password..."
            isPassword
            value={data.password}
            onChange={handleDataChange("password")}
            onBlur={() => markTouched("password")}
            error={touched.password ? errors.password : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
          />
          <FieldError message={touched.password ? errors.password : ""} />
        </div>

        {/* Recovery for an account created but never verified: the code can
            only be entered on /register, so point them there rather than
            leaving them stuck. */}
        {unverifiedEmail ? (
          <div className="w-full border-2 border-ink bg-cream p-3 text-xs font-semibold text-ink">
            <p className="mb-2">
              Your code is waiting in your inbox. Enter it on the register page
              to finish setting up the account.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                to="/register"
                className="neo-sm bg-retro-yellow px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide"
              >
                Enter the code
              </Link>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendIn > 0 || isAuthPending}
                className="underline underline-offset-4 disabled:cursor-not-allowed disabled:text-ink/40 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </div>
        ) : null}

        <Button
          disabled={isAuthPending}
          fullWidth
          onClick={handleLogin}
        >
          {isAuthPending ? "Logging in…" : "Login"}
        </Button>

        <small className="font-bold text-ink">
          Don&apos;t have an account?{" "}
          <Link
            className="neo-sm bg-retro-yellow px-1 font-extrabold uppercase tracking-wide hover:bg-cream"
            to="/register"
          >
            Register
          </Link>
        </small>
      </div>
    </div>
  );
};

export default Login;
