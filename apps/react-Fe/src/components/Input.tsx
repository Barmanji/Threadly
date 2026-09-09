import React from "react";
import { classNames } from "../utils";

const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (
  props
) => {
  return (
    <input
      {...props}
      className={classNames(
        "block w-full border-2 border-ink bg-cream px-5 py-4 font-medium text-ink placeholder:text-ink/50 focus:outline-none focus:ring-[3px] focus:ring-retro-orange",
        props.className || ""
      )}
    />
  );
};

export default Input;
