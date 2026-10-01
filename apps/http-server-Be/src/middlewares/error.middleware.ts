import mongoose from "mongoose";
import multer from "multer";

import logger from "../logger/winston.logger.js";
import { ApiError, type ApiFieldError } from "../utils/ApiError.js";
import { removeUnusedMulterImageFilesOnError } from "../utils/helper.js";
import { NextFunction, Request, Response } from "express";

/**
 * Turn anything that ended up in an `errors` array into a uniform
 * `{ path, message }` shape.
 *
 * Historically this project pushed several different shapes here:
 *  - express-validator via `validators/validate.ts` → `{ [path]: msg }`
 *  - mongoose ValidationError              → `Error` instances with `.path`/`.message`
 *  - mongoose duplicate-key errors         → `Error` with a `keyValue` object
 *
 * The client needs one predictable shape, so everything is funnelled
 * through here instead of each throw site hand-rolling its own.
 */
const normalizeErrors = (errors: unknown): ApiFieldError[] => {
  if (!errors) return [];

  if (Array.isArray(errors)) {
    return errors.flatMap((entry) => {
      // `{ [path]: message }` — produced by the express-validator middleware.
      if (entry && typeof entry === "object" && !(entry instanceof Error)) {
        const record = entry as Record<string, unknown>;
        // Already in the canonical shape.
        if (typeof record.path === "string" && typeof record.message === "string") {
          return [{ path: record.path, message: record.message }];
        }
        // `{ email: "must be an email" }` — key is the field name.
        return Object.entries(record).map(([path, message]) => ({
          path,
          message: String(message),
        }));
      }

      // A mongoose ValidationError entry: has `.path` and `.message`.
      if (entry instanceof Error) {
        const path = (entry as unknown as { path?: string }).path;
        return [{ path: path || "field", message: entry.message }];
      }

      return [{ path: "field", message: String(entry) }];
    });
  }

  return [{ path: "field", message: String(errors) }];
};

/**
 * Duplicate keys (e.g. the unique index on `username`/`email`) arrive as a
 * raw MongoServerError rather than an ApiError. Turn them into a 409 with a
 * message naming the field, so "email already taken" never shows up as a
 * generic 500 or a bare stack trace.
 */
const extractDuplicateKeyInfo = (err: unknown): { field: string; value: string } | null => {
  if (!err || typeof err !== "object") return null;
  const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue;
  if (!keyValue) return null;
  const field = Object.keys(keyValue)[0];
  if (!field) return null;
  return { field, value: String(keyValue[field]) };
};

/**
 * Translate a multer rejection into an ApiError.
 *
 * multer signals "too big" / "too many" / "wrong type" by throwing a
 * `MulterError`, which is not a mongoose error, so it used to fall through to
 * the generic branch and become a 500 with either a raw multer message in
 * development or a useless "something went wrong" in production. Every one of
 * these is the client's fault and deserves a 4xx that says what to change.
 */
const describeMulterError = (err: unknown): ApiError | null => {
  if (!err || typeof err !== "object") return null;
  if (!(err instanceof multer.MulterError)) return null;

  const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))}MB`;

  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      // `limit` is set by multer at runtime but is not on the published type.
      return new ApiError(
        413,
        `That file is too large. The maximum is ${mb(Number((err as unknown as { limit?: number }).limit))} per file.`,
        [{ path: err.field ?? "file", message: "File too large" }],
        "VALIDATION_ERROR",
      );
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return new ApiError(
        400,
        "That file cannot be uploaded here. Check the file type and how many files you are sending.",
        [{ path: err.field ?? "file", message: "File not accepted" }],
        "VALIDATION_ERROR",
      );
    case "LIMIT_PART_COUNT":
      return new ApiError(
        400,
        "Too many parts in that upload.",
        undefined,
        "VALIDATION_ERROR",
      );
    default:
      return new ApiError(
        400,
        "That upload could not be accepted.",
        undefined,
        "VALIDATION_ERROR",
      );
  }
};

const errorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  let apiError: ApiError;

  if (err instanceof ApiError) {
    apiError = err;
  } else {
    const multerError = describeMulterError(err);
    // Duplicate username/email — a conflict, not a server fault.
    const duplicate = multerError ? null : extractDuplicateKeyInfo(err);
    if (multerError) {
      apiError = multerError;
    } else if (duplicate) {
      const label = duplicate.field === "email" ? "email address" : "username";
      apiError = new ApiError(
        409,
        `An account with this ${label} already exists.`,
        [{ path: duplicate.field, message: `This ${label} is already taken` }],
        "CONFLICT",
      );
    } else {
      const isMongooseError = err instanceof mongoose.Error;
      const statusCode = isMongooseError ? 400 : 500;

      // Never leak an internal stack/DB message to the client in production.
      const rawMessage = err instanceof Error && err.message ? err.message : "Something went wrong";
      const message =
        statusCode === 500 && process.env.NODE_ENV === "production"
          ? "Something went wrong on our end. Please try again."
          : rawMessage;

      const stack = err instanceof Error ? err.stack : undefined;
      const isValidationError = (err as mongoose.Error.ValidationError)?.name === "ValidationError";
      apiError = new ApiError(
        statusCode,
        message,
        normalizeErrors(isValidationError ? (err as mongoose.Error.ValidationError).errors : []),
        undefined,
        stack,
      );
    }
  }

  const fieldErrors = normalizeErrors(apiError.errors);

  // Build the payload explicitly rather than spreading the Error subclass,
  // which previously leaked `name`/`stack` internals into every response.
  const response: Record<string, unknown> = {
    statusCode: apiError.statusCode,
    success: false,
    message: apiError.message,
    code: apiError.code,
    errors: fieldErrors,
    data: null,
  };

  if (process.env.NODE_ENV === "development") {
    response.stack = apiError.stack;
  }

  logger.error(`${apiError.statusCode} ${req.method} ${req.originalUrl} - ${apiError.message}`);

  removeUnusedMulterImageFilesOnError(req);

  // If headers are already sent (e.g. an error thrown mid-stream during a
  // file download) we cannot rewrite the status — just close the connection.
  if (res.headersSent) {
    return next(err);
  }

  return res.status(apiError.statusCode).json(response);
};

export { errorHandler, normalizeErrors };
