import { CheckIcon, XMarkIcon } from "@heroicons/react/20/solid";

interface FieldErrorProps {
  message: string;
  id?: string;
}

/** Inline validation message, rendered directly beneath its input. */
export const FieldError: React.FC<FieldErrorProps> = ({ message, id }) => {
  if (!message) return null;
  return (
    <p
      id={id}
      role="alert"
      className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-retro-red"
    >
      <XMarkIcon className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
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
