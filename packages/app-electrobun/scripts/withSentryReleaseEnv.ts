import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  electrobunSentryDist,
  electrobunSentryRelease,
} from "../src/diagnostics/sentryConfig";
import {
  desktopSentryReleaseEnvironment,
  desktopSentryUpload,
  readDesktopSentrySecrets,
} from "./sentryReleaseEnvironment";
import { desktopSentryCommit } from "./sentryReleaseSource";
import {
  desktopSourceMapUploadArgs,
  desktopSourceMapUploadEnv,
  uploadDesktopSourceMaps,
} from "./sentrySourceMaps";

// Runs a desktop build command with the tier's public Sentry defines set — the
// diagnostics counterpart to scripts/withBuildInfoEnv.sh, which stamps build
// identity. It is a wrapper rather than part of the build script so the DSN is
// selected in one place for `electrobun build`, its main-process bundle, and the
// packaged renderer rebuild in packageElectrobunAssets.ts: the postBuild hook
// inherits this environment and stages source maps outside the app. This parent
// alone holds the upload token and uploads the staged maps after the build.
//
// ELECTROBUN_RELEASE_TIER selects staging or production. Unset is a local build:
// no secrets are read, no maps are staged or uploaded, and the renderer keeps
// its local-only System Monitor logging. BUN_PUBLIC_GIT_SHA stays the short
// display SHA; Sentry needs the full one to match an uploaded release.
const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const { ELECTROBUN_RELEASE_TIER: tier } = process.env;
const command = process.argv.slice(2);
if (!command.length) throw new Error("withSentryReleaseEnv requires a command");

const secrets = tier
  ? {
      ...(await readDesktopSentrySecrets(
        resolve(repoRoot, ".secrets/root.env"),
      )),
      ...(await readDesktopSentrySecrets(
        resolve(
          repoRoot,
          ".secrets",
          tier === "production" ? "prod.env" : "staging.env",
        ),
      )),
      ...process.env,
    }
  : process.env;
const sourceMapDir = resolve(packageRoot, "build/sentry-sourcemaps");
const commit = tier ? desktopSentryCommit(repoRoot) : "";
// Resolved before building, so a release that cannot upload never builds.
const upload = tier ? desktopSentryUpload(secrets, tier) : undefined;
if (upload) await rm(sourceMapDir, { recursive: true, force: true });

const [executable, ...args] = command;
const build = Bun.spawn([executable ?? "", ...args], {
  cwd: process.cwd(),
  env: desktopSentryReleaseEnvironment(
    secrets,
    tier,
    commit,
    upload ? sourceMapDir : undefined,
  ),
  stdout: "inherit",
  stderr: "inherit",
});
const code = await build.exited;
if (!upload) process.exit(code);
if (code !== 0) {
  await rm(sourceMapDir, { recursive: true, force: true });
  process.exit(code);
}
await uploadDesktopSourceMaps(sourceMapDir, () => {
  if (desktopSentryCommit(repoRoot) !== commit)
    throw new Error("Source revision changed during the desktop Sentry build");
  return Bun.spawn(
    [
      "bun",
      "run",
      "sentry:cli",
      ...desktopSourceMapUploadArgs({
        org: upload.org,
        project: upload.project,
        release: electrobunSentryRelease(commit),
        dist: electrobunSentryDist(upload.environment),
        directory: relative(packageRoot, sourceMapDir),
      }),
    ],
    {
      cwd: packageRoot,
      env: desktopSourceMapUploadEnv(process.env, upload.token),
      stdout: "inherit",
      stderr: "inherit",
    },
  ).exited;
});
process.exit(0);
