import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  electrobunSentryDist,
  electrobunSentryRelease,
} from "../src/diagnostics/sentryConfig";
import { desktopSourceCommit } from "./desktopSourceCommit";
import {
  assertSentryTokenOrganization,
  hostedSentryEndpoint,
  resolveSentryCliBinary,
  runSentryCli,
  type SentryUploadEndpoint,
  sentryCliUploadUrl,
} from "./sentryCliUpload";
import {
  desktopSentryReleaseEnvironment,
  desktopSentryUpload,
  readDesktopSentrySecrets,
} from "./sentryReleaseEnvironment";
import { desktopSentryCommit } from "./sentryReleaseSource";
import {
  desktopSourceMapUploadArgs,
  uploadDesktopSourceMaps,
} from "./sentrySourceMaps";

// Runs a desktop build command with the tier's public Sentry defines set — the
// diagnostics counterpart to scripts/withBuildInfoEnv.sh, which stamps build
// identity. It is a wrapper rather than part of the build script so the DSN is
// selected in one place for `electrobun build`, its main-process bundle, and the
// packaged renderer rebuild in packageElectrobunAssets.ts: the postBuild hook
// inherits this environment and stages source maps outside the app. This parent
// alone holds the upload token and, after the build, uploads the staged maps
// through the pinned sentry-cli binary in an isolated environment
// (sentryCliUpload.ts).
//
// ELECTROBUN_RELEASE_TIER selects staging or production. Unset is a local build:
// no secrets are read, no maps are staged or uploaded, and the renderer keeps
// its local-only System Monitor logging. BUN_PUBLIC_GIT_SHA stays the short
// display SHA; Sentry needs the full one to match an uploaded release.

type Environment = Readonly<Record<string, string | undefined>>;

// Bun options, preload modules and debuggers named by these variables, and the
// DYLD_* libraries Bun's entitlements let macOS load, would run in, or attach
// to, the process that holds the upload token. releaseMacos.sh and
// buildElectrobun.sh unset the Bun variables before any Bun process starts, and
// /bin/sh drops DYLD_* variables; a wrapper started some other way refuses them.
const bunLaunchVariables = [
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_PRELOAD",
];

// Bun loads dotenv files, and any --env-file in BUN_OPTIONS, into this process
// before it runs, and a build machine may export another project's settings.
// So every SENTRY_* name, the upload token, organization, project and DSN
// included, comes only from .secrets; the environment supplies everything else.
async function releaseInputs(repoRoot: string, env: Environment) {
  const { ELECTROBUN_RELEASE_TIER: tier } = env;
  if (!tier) return { tier, secrets: env, commit: "", upload: undefined };
  const launch = Object.keys(env).filter(
    (name) =>
      env[name] !== undefined &&
      (bunLaunchVariables.includes(name) || name.startsWith("DYLD_")),
  );
  if (launch.length > 0)
    throw new Error(
      `Desktop Sentry releases must not run with ${launch.join(", ")}`,
    );
  const ambient = Object.entries(env).filter(
    ([name]) => !name.startsWith("SENTRY_"),
  );
  const secrets = {
    ...(await readDesktopSentrySecrets(resolve(repoRoot, ".secrets/root.env"))),
    ...(await readDesktopSentrySecrets(
      resolve(
        repoRoot,
        ".secrets",
        tier === "production" ? "prod.env" : "staging.env",
      ),
    )),
    ...Object.fromEntries(ambient),
  };
  // A checkout releases its own clean HEAD, whatever BUILD_GIT_SHA an earlier
  // Docker build left exported. A source archive has no Git directory and names
  // the commit it was exported from, which nothing here can verify, so its maps
  // must not be uploaded under that release.
  const { BUILD_GIT_SHA: exportedCommit } = env;
  if (!existsSync(join(repoRoot, ".git")))
    throw new Error(
      `Desktop Sentry source maps upload only from a clean Git checkout, not a source archive of ${desktopSourceCommit(repoRoot, exportedCommit)}`,
    );
  const commit = desktopSentryCommit(repoRoot);
  const upload = desktopSentryUpload(secrets, tier);
  return { tier, secrets, commit, upload };
}

export async function runDesktopSentryRelease(options: {
  packageRoot: string;
  repoRoot: string;
  command: readonly string[];
  env: Environment;
  endpoint: SentryUploadEndpoint;
}): Promise<number> {
  const { repoRoot, endpoint } = options;
  const [executable, ...args] = options.command;
  if (!executable) throw new Error("withSentryReleaseEnv requires a command");
  const { tier, secrets, commit, upload } = await releaseInputs(
    repoRoot,
    options.env,
  );
  const sourceMapDir = resolve(options.packageRoot, "build/sentry-sourcemaps");
  // Resolved before building, so a release that cannot upload never builds.
  const binary = upload ? resolveSentryCliBinary() : undefined;
  if (upload) {
    sentryCliUploadUrl(upload.token, endpoint);
    assertSentryTokenOrganization(upload.token, upload.org);
    await rm(sourceMapDir, { recursive: true, force: true });
  }
  const code = await Bun.spawn([executable, ...args], {
    cwd: process.cwd(),
    env: desktopSentryReleaseEnvironment(
      secrets,
      tier,
      commit,
      upload ? sourceMapDir : undefined,
    ),
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (!upload || !binary) return code;
  if (code !== 0) {
    await rm(sourceMapDir, { recursive: true, force: true });
    return code;
  }
  await uploadDesktopSourceMaps(sourceMapDir, () => {
    if (desktopSentryCommit(repoRoot) !== commit)
      throw new Error(
        "Source revision changed during the desktop Sentry build",
      );
    return runSentryCli({
      binary,
      endpoint,
      token: upload.token,
      args: desktopSourceMapUploadArgs({
        org: upload.org,
        project: upload.project,
        release: electrobunSentryRelease(commit),
        dist: electrobunSentryDist(upload.environment),
        directory: sourceMapDir,
      }),
    });
  });
  return 0;
}

if (import.meta.main) {
  const packageRoot = resolve(import.meta.dirname, "..");
  process.exit(
    await runDesktopSentryRelease({
      packageRoot,
      repoRoot: resolve(packageRoot, "../.."),
      command: process.argv.slice(2),
      env: process.env,
      endpoint: hostedSentryEndpoint,
    }),
  );
}
