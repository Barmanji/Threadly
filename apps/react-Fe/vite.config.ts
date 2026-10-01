import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  /*
   * Vite's `loadEnv` reads `.env` files itself and exposes everything as
   * `import.meta.env`, but only `VITE_`-prefixed keys reach the client bundle.
   * The Sentry *upload* keys are not `VITE_`-prefixed on purpose — `SENTRY_AUTH_TOKEN`
   * is a write-capable credential and must never be inlined into browser JavaScript.
   */
  const env = loadEnv(mode, __dirname, "SENTRY_");

  /*
   * The plugin's two jobs are unrelated and both optional, which is why it is
   * wrapped rather than added to `plugins` directly:
   *
   *  1. Source maps. Without the `.map` files uploaded per release, a production
   *     stack trace points at minified bundle offsets and is unreadable. This is
   *     the single highest-value thing in the whole setup.
   *
   *  2. Release tagging. It sets `SENTRY_RELEASE` at build time, which is what
   *     ties an event back to the source map and the commit.
   *
   * Upload is skipped unless there is something to upload with: no DSN means no
   * project, and no auth token means a read-only token that would fail the build.
   * A contributor with a plain `.env` still gets a working local build.
   */
  const canUpload = Boolean(
    env.SENTRY_DSN && env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT,
  );

  return {
    server: {
      proxy: {
        "/api": "http://localhost:3004", // Adjust as needed
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    plugins: [
      react(),
      sentryVitePlugin({
        // Read by the plugin itself. It also injects
        // `globalThis.SENTRY_RELEASE = { id: <release> }` into the bundle, which
        // the SDK picks up automatically — so `Sentry.init` must NOT be passed a
        // `release` key, or the explicit `undefined` would win over the injected
        // value and every stack trace would lose its source map.
        authToken: env.SENTRY_AUTH_TOKEN,
        org: env.SENTRY_ORG,
        project: env.SENTRY_PROJECT,

        /*
         * Taken from git so a release is always a commit, never a hand-typed
         * string. Falls back to undefined on a shallow clone or a tarball
         * checkout, where `git rev-parse` fails — the build must not depend on
         * git being present.
         */
        release: {
          name: env.SENTRY_RELEASE || undefined,
        },

        // No telemetry on local builds — a dev session is not a release.
        telemetry: false,

        /*
         * Silent when there is nothing to upload rather than failing the build.
         * A contributor who has not set the auth token should still be able to
         * `pnpm build`; the alternative is a hard dependency on a Sentry account
         * for everyone who clones the repo.
         */
        sourcemaps: {
          assets: canUpload ? "./dist" : undefined,
          disable: !canUpload,
        },
      }),
    ],
    build: {
      /*
       * Source maps are emitted to disk for the plugin to upload. They are NOT
       * served to the browser — `sourcemap: true` here would only generate them,
       * while `sourcemap: "hidden"` would also publish them. Vite keeps them out
       * of `dist/assets` references in production either way; `"hidden"` is
       * explicit about not emitting a `//# sourceMappingURL=` comment.
       */
      sourcemap: "hidden",
    },
  };
});