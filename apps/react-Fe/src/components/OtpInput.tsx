import React, { useEffect, useRef } from "react";

interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}

/**
 * Segmented 6-digit code entry.
 *
 * - typing advances to the next box
 * - backspace on an empty box steps back
 * - pasting a full code distributes it across the boxes
 * - the boxes stay mounted so a wrong code can be corrected in place
 */
const OtpInput: React.FC<OtpInputProps> = ({
  length = 6,
  value,
  onChange,
  disabled,
  invalid,
}) => {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  // Keep focus on the first empty box as the user progresses.
  useEffect(() => {
    const index = value.length;
    if (index < length && document.activeElement?.tagName === "BODY") {
      refs.current[index]?.focus();
    }
  }, [value, length]);

  const setAt = (index: number, char: string) => {
    const chars = value.padEnd(length, " ").split("");
    chars[index] = char;
    onChange(chars.join("").replace(/\s/g, "").slice(0, length));
  };

  const handleChange = (index: number, raw: string) => {
    // Strip anything that isn't a digit.
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      setAt(index, " ");
      return;
    }

    // A paste (or a fast multi-char input) lands several digits at once.
    if (digits.length > 1) {
      /*
       * A paste that fills every box is unambiguously the whole code, so it
       * REPLACES what is there rather than being appended to it.
       *
       * Appending is right for a partial paste into a later box, and wrong for
       * a full one. Correcting a typo by pasting the right code into a
       * half-filled field interleaved the two: with "8" already in the first
       * box, pasting "999001" produced "899900" — a code the user never typed,
       * which then failed as "that code isn't right" while the inbox held the
       * one they were looking at.
       */
      const merged =
        digits.length >= length
          ? digits.slice(0, length)
          : (value + digits).slice(0, length);

      onChange(merged);
      const next = Math.min(merged.length, length - 1);
      refs.current[next]?.focus();
      return;
    }

    setAt(index, digits);
    if (index < length - 1) refs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (value[index]) {
        setAt(index, " ");
      } else if (index > 0) {
        setAt(index - 1, " ");
        refs.current[index - 1]?.focus();
      }
    }
    if (e.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < length - 1)
      refs.current[index + 1]?.focus();
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="Verification code">
      {Array.from({ length }).map((_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={length}
          value={value[index] ?? ""}
          disabled={disabled}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          className={
            "h-14 w-11 border-2 border-ink bg-cream text-center text-xl font-extrabold text-ink focus:outline-none focus:ring-[3px] focus:ring-retro-orange sm:w-12 " +
            (invalid
              ? "border-retro-red focus:ring-retro-red"
              : "")
          }
        />
      ))}
    </div>
  );
};

export default OtpInput;
