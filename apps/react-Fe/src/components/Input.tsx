import React from "react";
import { classNames } from "../utils";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Validation message for this field. When set, the input gets an error
   * treatment (red border/ring) and `aria-invalid` so screen readers announce
   * it alongside the label.
   */
  error?: string;
  /** Renders a "Show"/"Hide" toggle for password fields. */
  isPassword?: boolean;
}

const Input: React.FC<InputProps> = ({ error, isPassword, className, ...props }) => {
  const [revealed, setRevealed] = React.useState(false);

  const input = (
    <input
      {...props}
      type={isPassword ? (revealed ? "text" : "password") : props.type}
      aria-invalid={error ? true : undefined}
      className={classNames(
        "block w-full border-2 bg-cream px-5 py-4 font-medium text-ink placeholder:text-ink/50 focus:outline-none",
        error
          ? "border-retro-red focus:ring-[3px] focus:ring-retro-red"
          : "border-ink focus:ring-[3px] focus:ring-retro-orange",
        // Leave room for the reveal toggle when one is shown.
        isPassword ? "pr-16" : "",
        className || "",
      )}
    />
  );

  if (!isPassword) {
    return input;
  }

  return (
    <div className="relative">
      {input}
      <button
        type="button"
        onClick={() => setRevealed((prev) => !prev)}
        className="absolute right-3 top-1/2 -translate-y-1/2 border-2 border-ink bg-retro-yellow px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-ink focus:outline-none"
        aria-label={revealed ? "Hide password" : "Show password"}
      >
        {revealed ? "Hide" : "Show"}
      </button>
    </div>
  );
};

export default Input;
