/**
 * Shared form validation.
 *
 * Kept as plain functions rather than pulling in a schema library because the
 * rules are small, need to run on every keystroke, and are consumed by both
 * the register and login forms.
 *
 * The backend enforces the same rules independently — this is a UX affordance
 * for the user, not the security boundary.
 */

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const USERNAME_REGEX = /^[a-zA-Z0-9._]+$/;

/** The single-line summary shown under the password field. */
export const PASSWORD_RULES_SUMMARY =
  "At least 8 characters, including an uppercase letter, a lowercase letter, a number and a special character.";

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

/** Drives the live per-rule checklist under the password input. */
export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: "uppercase", label: "An uppercase letter", test: (v) => /[A-Z]/.test(v) },
  { id: "lowercase", label: "A lowercase letter", test: (v) => /[a-z]/.test(v) },
  { id: "number", label: "A number", test: (v) => /\d/.test(v) },
  {
    id: "special",
    label: "A special character",
    test: (v) => /[^A-Za-z0-9\s]/.test(v),
  },
];

/** Which of the rules the current value satisfies. */
export const checkPasswordRules = (value: string): Record<string, boolean> =>
  PASSWORD_RULES.reduce<Record<string, boolean>>(
    (acc, rule) => ({ ...acc, [rule.id]: rule.test(value) }),
    {},
  );

export const isPasswordValid = (value: string): boolean =>
  PASSWORD_RULES.every((rule) => rule.test(value));

export interface FieldValidation {
  isValid: boolean;
  message: string;
}

const VALID: FieldValidation = { isValid: true, message: "" };

export const validateEmail = (email: string): FieldValidation => {
  const value = email.trim();
  if (!value) return { isValid: false, message: "Email address is required." };
  if (!EMAIL_REGEX.test(value))
    return { isValid: false, message: "That doesn't look like a valid email address." };
  return VALID;
};

export const validateUsername = (username: string): FieldValidation => {
  const value = username.trim();
  if (!value) return { isValid: false, message: "Username is required." };
  if (value.length < 3)
    return {
      isValid: false,
      message: "Username must be at least 3 characters long.",
    };
  if (value.length > 24)
    return {
      isValid: false,
      message: "Username can't be longer than 24 characters.",
    };
  if (!USERNAME_REGEX.test(value))
    return {
      isValid: false,
      message: "Use only letters, numbers, dots and underscores.",
    };
  return VALID;
};

export const validatePassword = (password: string): FieldValidation => {
  if (!password) return { isValid: false, message: "Password is required." };
  if (!isPasswordValid(password))
    return { isValid: false, message: PASSWORD_RULES_SUMMARY };
  return VALID;
};

export const validateAvatar = (avatar: File | null): FieldValidation => {
  if (!avatar) return { isValid: false, message: "Choose a profile picture." };
  if (!avatar.type.startsWith("image/"))
    return { isValid: false, message: "The profile picture must be an image." };
  if (avatar.size > 5 * 1024 * 1024)
    return { isValid: false, message: "That image is larger than 5 MB." };
  return VALID;
};

export interface RegisterValues {
  email: string;
  username: string;
  password: string;
  avatar: File | null;
}

export type RegisterField = keyof RegisterValues;

export interface RegisterErrors {
  email: string;
  username: string;
  password: string;
  avatar: string;
}

export const EMPTY_REGISTER_ERRORS: RegisterErrors = {
  email: "",
  username: "",
  password: "",
  avatar: "",
};

/** Validate a single field, returning the message to display ("" when valid). */
export const validateRegisterField = (
  field: RegisterField,
  values: RegisterValues,
): string => {
  switch (field) {
    case "email":
      return validateEmail(values.email).message;
    case "username":
      return validateUsername(values.username).message;
    case "password":
      return validatePassword(values.password).message;
    case "avatar":
      return validateAvatar(values.avatar).message;
    default:
      return "";
  }
};

/**
 * Validate every field at once, for a submit attempt.
 *
 * Returns the per-field messages so each error renders next to its own input,
 * rather than one generic toast.
 */
export const validateRegisterForm = (values: RegisterValues): RegisterErrors => ({
  email: validateRegisterField("email", values),
  username: validateRegisterField("username", values),
  password: validateRegisterField("password", values),
  avatar: validateRegisterField("avatar", values),
});

export const isRegisterFormValid = (values: RegisterValues): boolean =>
  Object.values(validateRegisterForm(values)).every((message) => message === "");

/** Mask an address for display, e.g. `bo***@gmail.com`. */
export const maskEmailForDisplay = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
};
