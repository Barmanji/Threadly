import { Link } from "react-router-dom";
import { DocumentTextIcon } from "@heroicons/react/20/solid";

/**
 * The changelog entry point.
 *
 * One component behind all three placements (hero, beside the theme toggle,
 * sidebar footer) so they cannot drift apart — the point of the hero/toggle pair
 * is to compare positions, and that comparison is only meaningful if the thing
 * being compared is identical.
 *
 * Colours are palette tokens only (`retro-orange`, `ink`), so it re-themes with
 * everything else and needs no `dark:` variant.
 *
 * `size` changes the box, never the treatment:
 *   - `lg`  hero, level with the CTA buttons
 *   - `md`  beside the theme toggle; h-12/sm:h-14 matches ThemeToggle exactly,
 *           which is what made the original toggle look wrong sitting in a row
 *           of chunky buttons
 *   - `sm`  sidebar footer. Uses `neo-sm` (2px/3px against 3px/5px) because at
 *           that size the full treatment reads as a second primary action, and
 *           the footer is meant to recede.
 */
type ChangelogLinkProps = {
  size?: "lg" | "md" | "sm";
  className?: string;
};

const ChangelogLink: React.FC<ChangelogLinkProps> = ({
  size = "lg",
  className = "",
}) => {
  const box =
    size === "lg"
      ? "px-6 py-3 text-base sm:text-lg"
      : size === "md"
        ? "h-12 px-4 text-sm sm:h-14"
        : "px-3 py-2 text-[11px]";

  const treatment = size === "sm" ? "neo-sm" : "neo";

  return (
    <Link
      to="/changelog"
      className={`${treatment} neo-press inline-flex items-center justify-center gap-2 bg-retro-orange font-extrabold uppercase tracking-wide text-ink ${box} ${className}`}
    >
      <DocumentTextIcon
        className={size === "sm" ? "h-4 w-4" : "h-5 w-5"}
        aria-hidden="true"
      />
      <span>Changelog</span>
    </Link>
  );
};

export default ChangelogLink;
