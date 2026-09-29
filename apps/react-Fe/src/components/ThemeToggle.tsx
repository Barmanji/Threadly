import { MoonIcon, SunIcon } from "@heroicons/react/20/solid";
import { useTheme } from "../context/ThemeContext";

/**
 * Light/dark switch.
 *
 * Matches its row-mates in the chat sidebar header exactly: same `neo` border
 * and offset shadow, same height. It was on `neo-sm`, which is a 2px border and
 * a 3px shadow against their 3px and 5px, so it read as a smaller, flatter
 * button dropped into the middle of a row of chunky ones.
 */
const ThemeToggle: React.FC<{ className?: string }> = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className={`neo neo-press inline-flex h-12 flex-shrink-0 items-center justify-center bg-retro-blue px-3 text-paper sm:h-14 ${className}`}
    >
      {isDark ? (
        <SunIcon className="h-5 w-5" aria-hidden="true" />
      ) : (
        <MoonIcon className="h-5 w-5" aria-hidden="true" />
      )}
    </button>
  );
};

export default ThemeToggle;
