import { createSentryWinstonTransport } from "@sentry/node";
import winston from "winston";
import TransportStream from "winston-transport";

/*
 * `TransportStream` is the base class the Sentry transport extends, and it is
 * what the SDK's own documentation passes in.
 *
 * It is a direct dependency rather than winston's `winston.Transport`
 * re-export because that re-export is present at runtime but absent from
 * winston's type definitions, and `winston.transport` is only the TypeScript
 * namespace — using either as a value produces a class that fails to
 * construct. Depending on it directly is both the documented form and the one
 * that type-checks.
 */
const SentryWinstonTransport = createSentryWinstonTransport(TransportStream, {
  levels: ["warn", "error", "fatal"],
});

// Define your severity levels.
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// This method set the current severity based on
// the current NODE_ENV: show all the log levels
// if the server was run in development mode; otherwise,
// if it was run in production, show only warn and error messages.
const level = () => {
  const env = process.env.NODE_ENV || "development";
  const isDevelopment = env === "development";
  return isDevelopment ? "debug" : "warn";
};

// Define different colors for each level.
// Colors make the log message more visible,
// adding the ability to focus or ignore messages.
const colors = {
  error: "red",
  warn: "yellow",
  info: "blue",
  http: "magenta",
  debug: "white",
};

// Tell winston that you want to link the colors
// defined above to the severity levels.
winston.addColors(colors);

// Chose the aspect of your log customizing the log format.
const format = winston.format.combine(
  // Add the message timestamp with the preferred format
  winston.format.timestamp({ format: "DD MMM, YYYY - HH:mm:ss:ms" }),
  // Tell Winston that the logs must be colored
  winston.format.colorize({ all: true }),
  // Define the format of the message showing the timestamp, the level and the message
  winston.format.printf(
    (info) => `[${info.timestamp}] ${info.level}: ${info.message}`
  )
);

// Define which transports the logger must use to print out messages.
// In this example, we are using three different transports
const transports = [
  // Allow the use the console to print the messages
  new winston.transports.Console(),
  new winston.transports.File({ filename: "logs/error.log", level: "error" }),
  new winston.transports.File({ filename: "logs/info.log", level: "info" }),
  new winston.transports.File({ filename: "logs/http.log", level: "http" }),

  /*
   * Forward winston logs to Sentry as structured log events.
   *
   * This transport is NOT optional. Without it, none of the `logger.error` /
   * `logger.warn` calls anywhere in this codebase reach Sentry at all.
   * @sentry/node ships a winston integration but does NOT register it by
   * default — verified rather than assumed: the enabled integration list
   * contains no winston entry, so the SDK never sees these logs on its own.
   *
   * It matters more than it looks, because this logger's level is `warn`
   * outside development. `logger.info` is dropped before it ever reaches a
   * transport, so warn/error are the only log-level signal production
   * produces, and without this they go to files nobody reads.
   *
   * The class is built above with `levels: ["warn", "error", "fatal"]`
   * because the SDK's default captures trace through fatal, and winston's
   * `debug` level (active in development) would turn local noise into a
   * flood of Sentry log events.
   *
   * `uncolorize()` is required, not cosmetic. The shared `format` pipeline
   * calls `colorize({ all: true })`, which wraps the message in raw ANSI escape
   * sequences. Those are correct for a terminal and garbage in Sentry — the
   * event title renders as literal invisible control characters, and any search
   * for the error text fails to match. This transport re-runs the same
   * timestamp+printf shape without the color step so the log line Sentry stores
   * is the same line the file transport writes.
   */
  new SentryWinstonTransport({
    format: winston.format.combine(
      winston.format.timestamp({ format: "DD MMM, YYYY - HH:mm:ss:ms" }),
      winston.format.uncolorize(),
      winston.format.printf(
        (info) => `[${info.timestamp}] ${info.level}: ${info.message}`,
      ),
    ),
  }),
];

// Create the logger instance that has to be exported
// and used to log messages.
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
