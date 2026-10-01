/*
 * Bakes the release name into the build output.
 *
 * WHY THIS EXISTS
 *
 * Source map symbolication only works when the event's `release` matches the
 * release the artifacts were uploaded under. A backend gets that value at
 * RUNTIME from `SENTRY_RELEASE`, which means nothing at build time guarantees it
 * was ever set — and the failure is silent: the deploy succeeds, Sentry accepts
 * events, and every stack trace just points at `dist/index.js` line numbers
 * instead of TypeScript.
 *
 * The frontend plugin already derives its release from git automatically. This
 * makes the backend do the same by default, so the two cannot drift apart.
 * `SENTRY_RELEASE` still wins when set, which is what CI should use to pin both
 * apps to one value.
 *
 * Written to `dist/release.json` rather than inlined into the bundle because
 * `tsc` emits JavaScript and this is data. `instrument.ts` reads it at startup.
 */
import { execSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Prefer an explicit release from the environment, then fall back to the current
 * commit. Returns null rather than throwing when git is unavailable, because a
 * tarball or shallow export without `.git` must not fail the build.
 */
const resolveRelease = () => {
  if (process.env.SENTRY_RELEASE) return process.env.SENTRY_RELEASE;

  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
};

const release = resolveRelease();
const outFile = join(packageRoot, "dist", "release.json");

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `${JSON.stringify({ release }, null, 2)}\n`);

console.log(
  release
    ? `[sentry] baked release "${release}" into dist/release.json`
    : "[sentry] WARNING: no release resolved (no SENTRY_RELEASE and no git). " +
        "Events will be reported without a release and cannot be symbolicated.",
);