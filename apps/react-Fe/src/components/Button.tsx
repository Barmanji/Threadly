import React from "react";
import { classNames } from "../utils";

const Button: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    fullWidth?: boolean;
    severity?: "primary" | "secondary" | "danger";
    size?: "base" | "small";
  }
> = ({ fullWidth, severity = "primary", size = "base", ...props }) => {
  return (
    <>
      <button
        {...props}
        className={classNames(
          "border-[3px] border-ink shadow-[4px_4px_0_0_var(--color-ink)] transition-all duration-150 inline-flex shrink-0 justify-center items-center text-center font-extrabold uppercase tracking-wide text-ink select-none hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[3px_3px_0_0_var(--color-ink)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-50",
          fullWidth ? "w-full" : "",
          severity === "secondary"
            ? "bg-cream hover:bg-retro-red hover:text-paper"
            : severity === "danger"
              ? "bg-retro-red hover:bg-retro-red/90 text-paper"
              : "bg-retro-yellow hover:bg-retro-green",
          size === "small" ? "text-sm px-3 py-2" : "text-base px-5 py-3",
          props.className || ""
        )}
      >
        {props.children}
      </button>
    </>
  );
};

export default Button;