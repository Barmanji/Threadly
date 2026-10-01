import * as Sentry from "@sentry/node";
import dotenv from "dotenv";

/*
 * Loaded FIRST, before anything else in the server, via
 * `--require ./dist/instrument.js` in the start script.
 *
 * This has to happen before `app.ts` is imported, for one specific reason: Sentry
 * patches `http` and the module loader to instrument outgoing requests and catch
 * unhandled rejections. If those patches land after Express has already captured
 * its references, the first request of every deploy goes untraced and early
 * crashes never reach Sentry at all.
 *
 * `dotenv` is loaded here explicitly because `index.ts` does its own
 * `dotenv.config()`, and that runs too late — the SDK would read an empty DSN and
 * silently disable itself.
 */
dotenv.config({ path: "./.env" });

const dsn = process.env.SENTRY_DSN;
const environment = process.env.NODE_ENV || "development";
const release = process.env.SENTRY_RELEASE;

Sentry.init({
  // Spread conditionally for the same reason as the browser SDK: passing
  // `release: undefined` explicitly overwrites the value the release tooling
  // injects, and every server stack trace would lose its source map.
  ...(dsn ? { dsn } : {}),
  enabled: Boolean(dsn),
  environment,
  ...(release ? { release } : {}),

  /*
   * Node's default is 1.0 already, but stated explicitly because it is the
   * single number that decides whether a slow endpoint is visible or invisible,
   * and a silent change to it is invisible itself.
   */
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1,

  /*
   * `httpIntegration` spans the whole incoming request — params, matched route,
   * status — and is what attaches the route TEMPLATE (`/api/v1/chats/:chatId`)
   * rather than the concrete URL, so one chat's requests group with another's.
   */
  integrations: [
    Sentry.httpIntegration(),

    /*
     * This is the replacement for `setupExpressErrorHandler()`, which is
     * deprecated in v11. It captures a route handler's error at the moment it is
     * THROWN, which is strictly better than capturing it later: the stack still
     * points at the handler that failed, rather than at whatever the app's own
     * error middleware did afterwards.
     *
     * It also means this app's `errorHandler` does not have to cooperate at all —
     * it consumes the error and writes the response, and Sentry no longer needs
     * anything from it.
     *
     * The default gate already sends 5xx and drops 3xx/4xx, which is exactly
     * right here: the 409s and 401s this codebase throws deliberately are
     * expected outcomes, not faults. Stated explicitly anyway, because that
     * default is doing a lot of quiet work and is worth being able to see.
     */
    Sentry.expressIntegration({
      shouldHandleError: (error) => {
        /*
         * `statusCode` is typed `string | number` because the SDK has to accept
         * errors from every framework — Express sets a number, but some
         * middleware set the string form. `Number(...)` normalises it, and the
         * `NaN` fallback keeps a malformed value from reading as "not a server
         * error" and silently dropping a genuine fault.
         */
        const status = Number(error.statusCode ?? error.status ?? 500);
        return (Number.isNaN(status) ? 500 : status) >= 500;
      },
    }),

    // Node's own `diagnostics_channel` names for outgoing fetch/HTTP, plus the
    // hostname/port of the machine an event came from.
    Sentry.nodeContextIntegration(),
  ],

  /*
   * The one integration that matters most here, because this codebase's winston
   * level is `warn` in production: every `logger.info` is DROPPED when not in
   * development, and morgan is skipped entirely. So `logger.error` is the only
   * record a production failure leaves today, and it is a formatted string with
   * the stack discarded.
   *
   * Winston implements the `error`-level hook Sentry exposes, so error logs
   * become real events with their metadata attached — no `winston-sentry`
   * transport needed, and the existing `logger.error` call sites keep working
   * unchanged.
   */
  beforeSendLog(log) {
    if (log.level === "error") {
      // De-duplicate: the Express error handler logs AND Sentry captures the
      // same failure, which would double every 500 in the issue stream.
      return null;
    }
    return log;
  },

  /*
   * Per-endpoint sampling. The default rate is not a good fit for a chat
   * backend's traffic mix, and this is where that gets corrected.
   *
   * Health checks are excluded outright: they fire on a timer forever, would
   * dominate the transaction quota, and every one of them is a 200 that tells us
   * nothing.
   *
   * Whiteboard state is the opposite: it is the heaviest endpoint in the app (a
   * full document per save, on top of a WebRTC data channel), so it is sampled
   * at 100% even in production. When a whiteboard bug appears, the transaction
   * that shows it is the whole point.
   *
   * `inheritOrSampleWith` is what keeps an in-flight distributed trace intact:
   * once the browser has sampled a navigation, every child span on this server
   * follows that decision instead of rolling its own.
   */
  tracesSampler(samplingContext) {
    const fallback = Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 0.1;
    const name = samplingContext.name ?? "";

    if (name === "GET /api/v1/healthcheck") return 0;
    if (name.includes("/whiteboard")) return 1;

    return samplingContext.inheritOrSampleWith(fallback);
  },

  /**
   * Never ship credentials to a third party. Sentry captures request headers on
   * HTTP events, and this API authenticates with a bearer token, a refresh
   * cookie, and an email-verification code in the body.
   */
  beforeSend(event) {
    const request = event.request as
      | { headers?: Record<string, unknown>; data?: unknown; cookies?: unknown }
      | undefined;

    if (request?.headers) {
      delete request.headers.Authorization;
      delete request.headers.authorization;
      delete request.headers.cookie;
      delete request.headers.Cookie;
    }

    /*
     * The login, register and recovery bodies are passwords and one-time codes.
     * Dropping `data` outright is blunt but correct, and there is no request in
     * this app where the body is needed to diagnose the failure — the URL,
     * method and status already identify it.
     */
    if (request?.data !== undefined) {
      request.data = "[redacted]";
    }
    if (request?.cookies !== undefined) {
      request.cookies = "[redacted]";
    }

    return event;
  },
});

export default Sentry;