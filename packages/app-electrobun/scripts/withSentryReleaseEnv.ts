import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { desktopSourceCommit } from "./desktopSourceCommit";
import {
  hostedSentryEndpoint,
  type SentryUploadEndpoint,
} from "./sentryCliUpload";
import { desktopSentryReleaseEnvironment } from "./sentryReleaseEnvironment";
import { desktopSentryCommit } from "./sentryReleaseSource";
import {
  assertNoBunLaunchVariables,
  type Environment,
  prepareSourceMapUpload,
  readReleaseSecrets,
  type SourceMapUploader,
  uploadReleaseSourceMaps,
} from "./sentryReleaseUpload";
import { assertStagedSourceMaps } from "./sentrySourceMaps";

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

// Set only by buildLinuxNative.sh, inside the Linux release container. It is
// honoured only in a source archive, so a checkout release cannot skip its
// upload; any other value stops the build.
const deferredUploadName = "TEARLEADS_ELECTROBUN_SOURCEMAP_UPLOAD";

interface ReleaseInputs {
  readonly tier: string | undefined;
  readonly secrets: Environment;
  readonly commit: string;
  readonly uploader?: SourceMapUploader;
}

// A checkout release reads .secrets, releases its own clean HEAD whatever
// BUILD_GIT_SHA an earlier Docker build left exported, and uploads its maps.
async function checkoutRelease(
  repoRoot: string,
  tier: string,
  env: Environment,
  endpoint: SentryUploadEndpoint,
): Promise<ReleaseInputs> {
  if (!existsSync(join(repoRoot, ".git")))
    throw new Error(
      "A desktop release uploads its source maps from a clean Git checkout; only the Linux release container defers that upload",
    );
  const secrets = await readReleaseSecrets(repoRoot, tier, env);
  const commit = desktopSentryCommit(repoRoot);
  const uploader = prepareSourceMapUpload(secrets, tier, endpoint);
  return { tier, secrets, commit, uploader };
}

// The Linux release container builds a source archive with no Git directory and
// no upload credentials: releaseLinux.sh passes only the commit and the public
// DSNs. Its maps are staged and checked here, then copied out and uploaded on
// the host (uploadLinuxSourceMaps.ts), which verifies the commit against its
// own clean checkout before anything is published.
function archiveRelease(
  repoRoot: string,
  tier: string,
  env: Environment,
): ReleaseInputs {
  const { BUILD_GIT_SHA: exported, SENTRY_AUTH_TOKEN: token } = env;
  if (existsSync(join(repoRoot, ".git")))
    throw new Error(
      `Only a source archive may set ${deferredUploadName}; a checkout uploads its own source maps`,
    );
  if (token !== undefined || existsSync(join(repoRoot, ".secrets")))
    throw new Error(
      "A desktop build that defers its source-map upload must not hold upload credentials",
    );
  // Without it, Git would look for a checkout above the archive.
  if (!exported?.trim())
    throw new Error(
      "A desktop build that defers its source-map upload requires BUILD_GIT_SHA",
    );
  // There is no .secrets to read; the tier's public DSN is a Docker build
  // argument. Every other SENTRY_* name is still dropped.
  const dsn = `SENTRY_ELECTROBUN_${tier.toUpperCase()}_DSN`;
  const secrets = {
    ...Object.fromEntries(
      Object.entries(env).filter(([name]) => !name.startsWith("SENTRY_")),
    ),
    [dsn]: env[dsn],
  };
  return { tier, secrets, commit: desktopSourceCommit(repoRoot, exported) };
}

async function releaseInputs(
  repoRoot: string,
  env: Environment,
  endpoint: SentryUploadEndpoint,
): Promise<ReleaseInputs> {
  const { ELECTROBUN_RELEASE_TIER: tier, [deferredUploadName]: upload } = env;
  if (!tier) return { tier, secrets: env, commit: "" };
  assertNoBunLaunchVariables(env);
  if (upload === "deferred") return archiveRelease(repoRoot, tier, env);
  if (upload !== undefined)
    throw new Error(`${deferredUploadName} must be unset or deferred`);
  return checkoutRelease(repoRoot, tier, env, endpoint);
}

export async function runDesktopSentryRelease(options: {
  packageRoot: string;
  repoRoot: string;
  command: readonly string[];
  env: Environment;
  endpoint: SentryUploadEndpoint;
}): Promise<number> {
  const { repoRoot } = options;
  const [executable, ...args] = options.command;
  if (!executable) throw new Error("withSentryReleaseEnv requires a command");
  const { tier, secrets, commit, uploader } = await releaseInputs(
    repoRoot,
    options.env,
    options.endpoint,
  );
  const stagingDir = tier
    ? resolve(options.packageRoot, "build/sentry-sourcemaps")
    : undefined;
  if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
  const code = await Bun.spawn([executable, ...args], {
    cwd: process.cwd(),
    env: desktopSentryReleaseEnvironment(secrets, tier, commit, stagingDir),
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
  if (!stagingDir) return code;
  if (code !== 0) {
    await rm(stagingDir, { recursive: true, force: true });
    return code;
  }
  try {
    if (uploader)
      await uploadReleaseSourceMaps({ uploader, repoRoot, commit, stagingDir });
    // A deferred build leaves the checked pairs for releaseLinux.sh to copy.
    else assertStagedSourceMaps(stagingDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
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
