import { CheckIcon, XMarkIcon } from "@heroicons/react/20/solid";

interface FieldErrorProps {
  message: string;
  id?: string;
}

/**
 * Inline validation message, rendered directly beneath its input.
 *
 * The message itself is `text-ink`, not red. It used to be `text-retro-red`,
 * which on the dark theme's background was a contrast ratio of roughly 1.3:1 —
 * effectively invisible, and the reason these were hard to read. Lightening the
 * red would not have fixed it: a pale red on a mid-tone background is still a
 * low-contrast pair. Putting the text on an opaque `bg-paper` panel makes the
 * contrast a property of the theme rather than of whatever happens to be behind
 * the error, and red is kept for the bar and the icon as the accent.
 */
export const FieldError: React.FC<FieldErrorProps> = ({ message, id }) => {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 flex items-start gap-2 border-l-4 border-retro-red bg-paper px-2.5 py-1.5"
    >
      <XMarkIcon
        className="mt-px h-3.5 w-3.5 flex-shrink-0 text-retro-red"
        aria-hidden="true"
      />
      <span className="text-xs font-semibold text-ink">{message}</span>
    </p>
  );
};

interface PasswordRuleListProps {
  /** id -> satisfied, from `checkPasswordRules`. */
  results: Record<string, boolean>;
  rules: { id: string; label: string }[];
  summary: string;
  /** Only show once the user has started typing. */
  visible: boolean;
}

/**
 * Live per-rule checklist for the password field.
 *
 * Each rule ticks green as it becomes satisfied, so the user can see exactly
 * what is still missing instead of guessing from a single error string.
 */
export const PasswordRuleList: React.FC<PasswordRuleListProps> = ({
  results,
  rules,
  summary,
  visible,
}) => {
  if (!visible) return null;

  return (
    <div className="mt-2 border-2 border-ink/30 bg-paper/60 p-3">
      {/* The one-line rule summary, exactly as the user asked for it. */}
      <p className="mb-2 text-[11px] font-bold leading-relaxed text-ink/80">
        Password must be {summary}
      </p>
      <ul className="flex flex-col gap-1">
        {rules.map((rule) => {
          const ok = Boolean(results[rule.id]);
          return (
            <li
              key={rule.id}
              className="flex items-center gap-1.5 text-[11px] font-semibold"
            >
              {ok ? (
                <CheckIcon
                  className="h-3.5 w-3.5 flex-shrink-0 text-retro-green"
                  aria-hidden="true"
                />
              ) : (
                <XMarkIcon
                  className="h-3.5 w-3.5 flex-shrink-0 text-ink/30"
                  aria-hidden="true"
                />
              )}
              <span className={ok ? "text-retro-green" : "text-ink/50"}>
                {rule.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default FieldError;
