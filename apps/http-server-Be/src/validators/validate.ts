import { validationResult } from "express-validator";
import { ApiError, type ApiFieldError } from "../utils/ApiError.js";
import { NextFunction, Request, Response, RequestHandler } from "express";

export const validate: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) {
    return next();
  }

  // Use the canonical `{ path, message }` shape so the client can map each
  // failure straight onto the form field it belongs to.
  const extractedErrors: ApiFieldError[] = errors.array().map((err) => ({
    path: "path" in err ? err.path : "field",
    message: err.msg,
  }));

  // The first field error makes a far better headline than a generic string.
  const firstError = extractedErrors[0]?.message;

  // 422: Unprocessable Entity — the request was well-formed but the content
  // failed validation.
  throw new ApiError(
    422,
    firstError ? `${firstError}` : "Received data is not valid",
    extractedErrors,
    "VALIDATION_ERROR"
  );
};
