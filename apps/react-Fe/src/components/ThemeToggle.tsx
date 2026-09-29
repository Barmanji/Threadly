import { MoonIcon, SunIcon } from "@heroicons/react/20/solid";
import { useTheme } from "../context/ThemeContext";

/**
 * Light/dark switch.
 *
 * Sized to sit in the app's chunky neo-brutalist button rows without making
 * them any taller, so it uses the same `neo-sm` treatment as its neighbours.
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
      className={`neo-sm neo-press inline-flex h-12 flex-shrink-0 items-center justify-center bg-retro-blue px-3 text-paper sm:h-14 ${className}`}
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
