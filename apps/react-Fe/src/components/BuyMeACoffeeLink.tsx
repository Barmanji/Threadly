import { HeartIcon } from "@heroicons/react/20/solid";

/**
 * The "Buy me a coffee" support link.
 *
 * Lives on /changelog only, beside the theme toggle. Deliberately not on the
 * landing, login or register: the changelog is where someone who has just read
 * what shipped is most likely to be feeling generous, so that is the one page
 * that has to ask. Everywhere else it would just be a nag on the way to signing
 * up.
 *
 * It is an external `<a>`, not a router `Link` — Buy Me a Coffee is a different
 * site and a full page load. `rel="noopener noreferrer"` because
 * `target="_blank"` hands the opened tab a reference back to this one.
 *
 * The box matches `ChangelogLink size="md"` and `ThemeToggle` exactly
 * (h-12/sm:h-14), because it sits in the same `absolute right-4 top-4` row and
 * anything shorter reads as a mis-sized button dropped in.
 *
 * Colours are palette tokens only (`retro-yellow`, `ink`), so it re-themes with
 * everything else and needs no `dark:` variant. Retro-yellow keeps it clear of
 * the changelog heading's badge and the toggle's blue without inventing a token.
 */
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/barmanji";

const BuyMeACoffeeLink: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <a
    href={BUY_ME_A_COFFEE_URL}
    target="_blank"
    rel="noopener noreferrer"
    title="Support this project — buy me a coffee"
    className={`neo neo-press inline-flex h-12 flex-shrink-0 items-center justify-center gap-2 bg-retro-yellow px-4 text-sm font-extrabold uppercase tracking-wide text-ink sm:h-14 ${className}`}
  >
    <HeartIcon className="h-5 w-5" aria-hidden="true" />
    <span>Buy me a coffee</span>
  </a>
);

export default BuyMeACoffeeLink;