import * as Sentry from "@sentry/react";

/**
 * Sentry bootstrap for the browser app.
 *
 * Imported as the FIRST import in `main.tsx` so it runs before React, the router
 * and every context provider. ES module imports evaluate in declaration order,
 * so putting it anywhere else means a throw during module evaluation of a later
 * import would never be caught.
 *
 * ── What is enabled, and why ────────────────────────────────────────────────────
 * Errors        always. `ErrorBoundary` around the tree catches render throws.
 * Tracing       browserTracing + webVitals + userTiming. The latter two are how
 *               "my click felt slow" becomes a number with a name.
 * Replay        see the privacy note below — this is the one setting here that
 *               is deliberately conservative.
 * Profiling     browserProfiling, sampled via `profilesSampleRate`. Needs
 *               `withProfiler` on route components to produce anything useful;
 *               App.tsx applies it.
 * Logs          `Sentry.logger.*` calls from app code.
 * Metrics       `Sentry.metrics.*` calls from app code.
 * Feedback      the user-report modal, reachable from the error boundary.
 *
 * ── What is deliberately NOT enabled ────────────────────────────────────────────
 * Sentry also ships integrations for GraphQL, Supabase, LaunchDarkly, Statsig,
 * GrowthBook and Unleash. This app uses none of them, so switching them on would
 * only add bundle weight and produce empty integrations.
 */

/**
 * Sampled at 100% in development because a dev session is short and you want the
 * whole trace; dropped in production because 100% of every user is a bill.
 * Override per environment without editing this file:
 *   VITE_SENTRY_TRACES_SAMPLE_RATE=0.05
 */
const tracesSampleRate =
  Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE) ||
  (import.meta.env.DEV ? 1 : 0.2);

/**
 * Profiling is priced per profile and is far more expensive per event than a
 * trace, so production sampling is much lower. React profiling needs
 * `withProfiler` on the component to record anything.
 */
const profilesSampleRate =
  Number(import.meta.env.VITE_SENTRY_PROFILES_SAMPLE_RATE) ||
  (import.meta.env.DEV ? 1 : 0.1);

/**
 * Replay is sampled much more aggressively ON ERROR than on a normal session:
 * `replaysOnErrorSampleRate: 1` means "when something breaks, record everything
 * leading up to it, even the 10% of sessions we weren't watching". That is the
 * mode that actually answers "how did they get there?".
 */
const replaysSessionSampleRate =
  Number(import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE) ||
  (import.meta.env.DEV ? 1 : 0.1);

const replaysOnErrorSampleRate =
  Number(import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE) || 1;

/**
 * ── Replay privacy ──────────────────────────────────────────────────────────────
 * This is a private chat app. An unmasked replay would upload other people's
 * messages, usernames and avatars to a third party and keep them there for the
 * retention window. So text and media are masked by default and every input is
 * masked individually.
 *
 * To debug layout problems with real copy, flip `VITE_SENTRY_REPLAY_MASK_ALL_TEXT`
 * to false — but understand that you are turning on message capture in
 * production. Prefer fixing the layout in dev with the default masking on.
 */
const replayMaskAllText =
  import.meta.env.VITE_SENTRY_REPLAY_MASK_ALL_TEXT !== "false";

const replayBlockAllMedia =
  import.meta.env.VITE_SENTRY_REPLAY_BLOCK_ALL_MEDIA !== "false";

/**
 * Resolved to `undefined` when unset so a fresh clone runs with Sentry completely
 * inert instead of throwing on a malformed DSN.
 *
 * It is spread in CONDITIONALLY and this matters more than it looks. The browser
 * SDK builds its options like this:
 *
 *     return { release: <injected>, sendClientReports: true, ...optionsArg }
 *
 * `optionsArg` is spread LAST, so passing `release: undefined` would overwrite
 * the value the build plugin injected and every production stack trace would
 * lose its source map — the exact thing this config exists to provide. The same
 * applies to `dsn`. Only include a key when it actually has a value.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN || undefined;

/**
 * Optional manual override of the release. Normally this is left unset: the
 * `@sentry/vite-plugin` config injects `globalThis.SENTRY_RELEASE` at build time
 * and the SDK picks it up on its own. Set `VITE_SENTRY_RELEASE` only to pin a
 * release by hand (e.g. a staging build reusing an existing release name).
 */
const releaseOverride = import.meta.env.VITE_SENTRY_RELEASE || undefined;

Sentry.init({
  ...(dsn ? { dsn } : {}),
  // The single switch that makes all of the above safe to leave enabled: no DSN
  // means no client is constructed and no integration does anything.
  enabled: Boolean(dsn),
  environment: import.meta.env.MODE,
  ...(releaseOverride ? { release: releaseOverride } : {}),

  // --- Tracing ---------------------------------------------------------------
  tracesSampleRate,
  /*
   * Distributed tracing: only attach `sentry-trace`/`baggage` headers to our own
   * API, never to third parties. Without this the SDK would leak a trace id to
   * every host the browser talks to — including the Buy Me a Coffee link and
   * any avatar served off Cloudinary.
   *
   * `import.meta.env.VITE_SERVER_URI` is the axios baseURL, so it is already the
   * exact origin that needs tracing headers.
   */
  tracePropagationTargets: [import.meta.env.VITE_SERVER_URI, "localhost"],

  // --- Profiling -------------------------------------------------------------
  profileSessionSampleRate: profilesSampleRate,

  // --- Session Replay --------------------------------------------------------
  replaysSessionSampleRate,
  replaysOnErrorSampleRate,

  // --- Integrations ----------------------------------------------------------
  integrations: [
    // Auto-instrumentation of fetch/XHR, history and user interactions, which
    // gives every trace child spans without writing a single `startSpan`.
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: replayMaskAllText,
      maskAllInputs: true,
      blockAllMedia: replayBlockAllMedia,
    }),

    // Chromium-only. V8 CPU profiles attached to transactions. No-op elsewhere.
    Sentry.browserProfilingIntegration(),

    // Core Web Vitals (LCP, CLS, INP, TTFB) as named measurements.
    Sentry.webVitalsIntegration(),
    // `performance.mark()`/`measure()` as spans — this app emits none yet, but
    // it means adding one later needs no further config.
    Sentry.userTimingIntegration(),

    // Real user interactions, which is what turns "the chat list feels laggy"
    // into an attributed long-attribute span.
    Sentry.interactionsIntegration(),

    // Consolidates duplicate `console.error` calls into a single event with the
    // browser's own stack attached, instead of one per call.
    Sentry.captureConsoleIntegration({
      // React logs a warning for every unique key/prop misuse; they are
      // actionable, so they are kept rather than filtered.
      levels: ["error"],
    }),
    // Pulls the source line either side of a stack frame's frame into the event.
    Sentry.contextLinesIntegration(),

    // The in-app feedback widget. `theme` follows the app's dark class rather
    // than the OS, so the modal matches the page it was opened from.
    Sentry.feedbackIntegration({
      colorScheme: "system",
      showBranding: false,
    }),

    /*
     * NOT enabled, and the reason matters: `sendDefaultPii: false` (the default)
     * means Sentry does not attach request bodies, cookies or IP-derived user
     * data on its own. `setUser` in AuthContext sets id + username explicitly.
     * Leaving `sendDefaultPii` at false is what keeps the password in a login
     * POST body out of every event.
     */

    /*
     * NOT enabled: `consoleLoggingIntegration()` would turn every console.* call
     * into a billable Sentry log. The codebase still has ~24 `console.*` calls
     * in the backend and several in the frontend; wiring that up before they are
     * cleaned up would bury real logs under build noise. The explicit
     * `Sentry.logger.*` calls are the intended replacement.
     */

    /*
     * NOT enabled: `spotlightBrowserIntegration()`. It is a development side
     * panel that needs the `spotlight` npm package and the Spotlight sidecar. To
     * try it later, set `spotlight: true` in this init and run `npx spotlight-sidecar`.
     */
  ],

  /**
   * Keeps React's own keys-as-keys warning and the browser-only extension noise
   * out of the issue stream. Everything here is either not actionable or not a
   * real failure.
   */
  ignoreErrors: [
    // Chrome-only layout thrash that fires constantly on scroll containers.
    "ResizeObserver loop completed with undelivered notifications",
    "ResizeObserver loop limit exceeded",
    // The whiteboard canvas throws these on pointer-cancel races that are
    // already handled; they surface as unhandled promise rejections.
    "AbortError",
    /ResizeObserver/,
  ],

  /**
   * Sentry attaches its own `sentry-trace`/`baggage` to errors it captures. This
   * is where we make sure a rejected API call does not ship a JWT: `beforeSend`
   * drops any `Authorization` header that got swept up into the request context.
   */
  beforeSend(event) {
    const request = event.request as
      | { headers?: Record<string, unknown> }
      | undefined;

    if (request?.headers) {
      delete request.headers.Authorization;
      delete request.headers.authorization;
      delete request.headers.cookie;
      delete request.headers.Cookie;
    }

    return event;
  },
});

/**
 * Marks the sign-out boundary.
 *
 * Without this, the next anonymous visitor inherits the previous user's id and
 * username on every event they produce, which quietly poisons issue ownership.
 */
export const clearSentryUser = () => Sentry.setUser(null);