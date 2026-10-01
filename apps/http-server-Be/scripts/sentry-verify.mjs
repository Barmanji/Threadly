/*
 * Sends one of every kind of event this setup produces, so the dashboard can be
 * checked against a known list instead of guessed at.
 *
 * Run with:  pnpm --filter http-server-be sentry-verify
 *
 * Nothing here is production code. It exists because the failure mode of a
 * monitoring setup is silence — a broken DSN, a missing transport or a bad
 * release all look exactly like "nothing is happening", and the only way to tell
 * those apart is to send something known and look for it.
 *
 * Every event carries a `verify_run` tag, so a single run's events can be found
 * and deleted together from the dashboard afterwards.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const RUN_ID = `verify-${Date.now().toString(36)}`;
const PORT = 39117;

const dsn = process.env.SENTRY_DSN;
if (!dsn) {
  console.error(
    "No SENTRY_DSN. Load it first, e.g.  set -a && . ./.env && set +a",
  );
  process.exit(1);
}

/*
 * Every scenario runs in a child process that preloads `dist/instrument.js`,
 * because that is the only way to reproduce the real init order and prove the
 * SDK is wired the same way the server wires it.
 */
const runScenario = (name, code) =>
  new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "./dist/instrument.js", "-e", code],
      {
        env: { ...process.env, VERIFY_RUN: RUN_ID, PORT: String(PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ name, exit: code, out }));
  });

const scenarios = [
  {
    name: "1. captureException with user + tags",
    expect: "Issue titled 'VerificationError: deliberate test'",
    code: `
      const S = require('@sentry/node');
      S.getCurrentScope().setUser({ id: 'verify-user-001' });
      S.setTag('verify_run', process.env.VERIFY_RUN);
      const err = new Error('deliberate test');
      err.name = 'VerificationError';
      S.captureException(err, { tags: { scenario: 'captureException' } });
      S.flush(6000).then(() => process.exit(0));
    `,
  },
  {
    name: "2. captureMessage (non-error level)",
    expect: "Issue titled 'Health probe failing'",
    code: `
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);
      S.captureMessage('Health probe failing', { level: 'warning' });
      S.flush(6000).then(() => process.exit(0));
    `,
  },
  {
    name: "3. winston logger.error -> Sentry Logs",
    expect: "Logs view, message '[verify] winston error reached sentry'",
    code: `
      const logger = require('./dist/logger/winston.logger.js').default;
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);
      logger.error('[verify] winston error reached sentry');
      S.flush(6000).then(() => process.exit(0));
    `,
  },
  {
    name: "4. winston logger.warn -> Sentry Logs (not deduped)",
    expect: "Logs view, message '[verify] winston warn reached sentry'",
    code: `
      const logger = require('./dist/logger/winston.logger.js').default;
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);
      logger.warn('[verify] winston warn reached sentry');
      S.flush(6000).then(() => process.exit(0));
    `,
  },
  {
    name: "5. expressIntegration captures a 500, not a 404",
    expect: "One issue for the 500, NO issue for the 404",
    code: `
      const express = require('express');
      const http = require('http');
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);

      const app = express();
      app.get('/boom', () => {
        // Thrown from inside a route handler. expressIntegration captures at
        // THROW time, so the stack should point at this line and not at the
        // error middleware below that handles it.
        const err = new Error('deliberate 500 from route handler');
        err.name = 'VerificationHttpError';
        throw err;
      });
      // A normal Express error middleware. It answers the client and swallows
      // the error, so nothing reaches the process-level uncaught handler and
      // the child exits cleanly. Sentry must not depend on this cooperating.
      app.use((err, _req, res, _next) => {
        res.status(err.statusCode ?? 500).json({ error: err.message });
      });

      const server = app.listen(Number(process.env.PORT), async () => {
        const get = (path) => new Promise((r) => {
          http.get({ port: Number(process.env.PORT), path }, (res) => {
            res.resume();
            r(res.statusCode);
          }).on('error', () => r(0));
        });
        console.log('boom ->', await get('/boom'));
        console.log('missing ->', await get('/no-such-route'));
        await new Promise((r) => setTimeout(r, 1500));
        server.close();
        S.flush(6000).then(() => process.exit(0));
      });
    `,
  },
  {
    name: "6. request credentials are redacted",
    expect: "Event request shows no Authorization / cookie and data '[redacted]'",
    code: `
      const express = require('express');
      const http = require('http');
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);

      const app = express();
      app.post('/login', () => {
        const err = new Error('deliberate 500 to inspect redaction');
        err.name = 'VerificationRedactionError';
        throw err;
      });
      app.use((err, _req, res, _next) => {
        res.status(err.statusCode ?? 500).json({ error: err.message });
      });

      const server = app.listen(Number(process.env.PORT), () => {
        const req = http.request(
          {
            port: Number(process.env.PORT),
            path: '/login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer THIS_MUST_NOT_APPEAR',
              Cookie: 'refreshToken=THIS_MUST_NOT_APPEAR_EITHER',
            },
          },
          (res) => { res.resume(); },
        );
        req.on('error', () => {});
        req.end(JSON.stringify({ email: 'verify@example.com', password: 'hunter2' }));
        setTimeout(() => {
          server.close();
          S.flush(6000).then(() => process.exit(0));
        }, 2000);
      });
    `,
  },
  {
    name: "7. unhandled rejection is captured",
    expect: "Issue 'UnhandledRejection: deliberate unhandled rejection'",
    code: `
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);
      Promise.reject(new Error('deliberate unhandled rejection'));
      setTimeout(() => S.flush(6000).then(() => process.exit(0)), 1500);
    `,
  },
  {
    name: "8. transaction reaches Performance",
    expect: "A transaction named 'verify-transaction' in the Performance view",
    code: `
      const S = require('@sentry/node');
      S.setTag('verify_run', process.env.VERIFY_RUN);
      // v11 renamed Span#setData to Span#setAttribute. Worth knowing: the same
      // rename hit any custom span attributes elsewhere.
      S.startSpan({ name: 'verify-transaction', op: 'verify.test' }, (span) => {
        span?.setAttribute('verification.marker', 'present');
      });
      S.flush(6000).then(() => process.exit(0));
    `,
  },
];

const run = async () => {
  console.log(`\n  Sentry verification run: ${RUN_ID}\n`);

  for (const s of scenarios) {
    process.stdout.write(`  ${s.name} ... `);
    const { exit, out } = await runScenario(s.name, s.code);
    console.log(exit === 0 ? "sent" : `FAILED (exit ${exit})`);
    console.log(`     expect: ${s.expect}`);
    if (exit !== 0) {
      // A failed scenario is the informative case, so its output is printed
      // rather than swallowed — otherwise the script just says "FAILED" and
      // tells you nothing about why.
      for (const line of out.trim().split("\n").slice(0, 12)) {
        console.log(`     | ${line}`);
      }
    }
  }

  console.log(
    `\n  Done. Filter the dashboard by tag verify_run=${RUN_ID}.\n` +
      `  If an expected event is missing, the most likely cause is in order:\n` +
      `    1. SENTRY_DSN missing or wrong project\n` +
      `    2. SENTRY_RELEASE not matching the uploaded artifacts\n` +
      `    3. Logs view filtered by time range — logs have a short retention\n` +
      `       window on most Sentry plans and can lag events by a minute.\n`,
  );
};

run();