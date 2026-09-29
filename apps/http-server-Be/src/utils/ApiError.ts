/**
 * A machine-readable, stable error code. The frontend maps these onto
 * field-level/inline errors; the human-readable `message` is what gets
 * toasted or rendered next to the offending input.
 *
 * Keeping this separate from `message` means we can reword any message
 * without breaking the client.
 */
type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EMAIL_NOT_VERIFIED"
  | "VERIFICATION_CODE_INVALID"
  | "INTERNAL_ERROR";

/** A single field-level problem: which field, and what is wrong with it. */
interface ApiFieldError {
  path: string;
  message: string;
}

class ApiError<T = any> extends Error {
  statusCode: number;
  data: T | null;
  success: boolean;
  /** Normalised to `ApiFieldError[]` by the error middleware. */
  errors: ApiFieldError[] | Error[];
  code: ApiErrorCode;

  constructor(
    statusCode: number,
    message = "Something went wrong",
    errors: ApiFieldError[] | Error[] = [],
    code?: ApiErrorCode,
    stack?: string,
  ) {
    super(message);

    this.statusCode = statusCode;
    this.data = null;
    this.success = false;
    this.errors = errors;
    this.code = code ?? ApiError.defaultCodeForStatus(statusCode);

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }

    this.name = this.constructor.name;
  }

  /** Derive a sensible default code so callers rarely need to pass one. */
  private static defaultCodeForStatus(statusCode: number): ApiErrorCode {
    switch (statusCode) {
      case 400:
      case 422:
        return "VALIDATION_ERROR";
      case 401:
        return "UNAUTHORIZED";
      case 403:
        return "FORBIDDEN";
      case 404:
        return "NOT_FOUND";
      case 409:
        return "CONFLICT";
      case 429:
        return "RATE_LIMITED";
      default:
        return "INTERNAL_ERROR";
    }
  }
}

export { ApiError };
export type { ApiErrorCode, ApiFieldError };
