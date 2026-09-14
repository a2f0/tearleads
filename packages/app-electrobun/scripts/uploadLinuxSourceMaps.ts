import { basename, isAbsolute, resolve } from "node:path";
import {
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";
import {
  hostedSentryEndpoint,
  type SentryUploadEndpoint,
} from "./sentryCliUpload";
import { desktopSentryCommit } from "./sentryReleaseSource";
import {
  assertNoBunLaunchVariables,
  type Environment,
  prepareSourceMapUpload,
  readReleaseSecrets,
  uploadReleaseSourceMaps,
} from "./sentryReleaseUpload";
import { assertStagedSourceMaps } from "./sentrySourceMaps";

// releaseLinux.sh builds in Docker, which has neither the upload token nor a Git
// checkout. The container stages the maps (withSentryReleaseEnv.ts, deferred),
// and releaseLinux.sh copies them to a host temporary directory and runs this
// before publishing. The commit is the BUILD_GIT_SHA the container built; it
// must be this clean checkout's HEAD, or the maps would name another release.
// The staged copy came from the container, so it must be exactly the expected
// pairs, as real files, with the main-process bundle built from that commit.
export async function runLinuxSourceMapUpload(options: {
  repoRoot: string;
  tier: string | undefined;
  commit: string | undefined;
  stagingDir: string | undefined;
  env: Environment;
  endpoint: SentryUploadEndpoint;
}): Promise<void> {
  const { repoRoot, tier, commit, stagingDir, env, endpoint } = options;
  assertNoBunLaunchVariables(env);
  if (
    !isSentryEnvironment(tier) ||
    !isSentryCommit(commit) ||
    !stagingDir ||
    !isAbsolute(stagingDir) ||
    basename(stagingDir) !== "sentry-sourcemaps"
  )
    throw new Error(
      "Usage: uploadLinuxSourceMaps.ts <staging|production> <full commit> <absolute sentry-sourcemaps directory>",
    );
  if (desktopSentryCommit(repoRoot) !== commit)
    throw new Error(
      "The Linux release commit is not this clean checkout's HEAD; release must not be published",
    );
  const secrets = await readReleaseSecrets(repoRoot, tier, env);
  const uploader = prepareSourceMapUpload(secrets, tier, endpoint);
  assertStagedSourceMaps(stagingDir);
  const bundle = await Bun.file(resolve(stagingDir, "bun/index.js")).text();
  if (!bundle.includes(commit))
    throw new Error(
      "The staged main-process bundle was not built from the release commit",
    );
  await uploadReleaseSourceMaps({ uploader, repoRoot, commit, stagingDir });
}

if (import.meta.main) {
  const [tier, commit, stagingDir, ...extra] = process.argv.slice(2);
  if (extra.length > 0)
    throw new Error("uploadLinuxSourceMaps.ts takes exactly three arguments");
  await runLinuxSourceMapUpload({
    repoRoot: resolve(import.meta.dirname, "../../.."),
    tier,
    commit,
    stagingDir,
    env: process.env,
    endpoint: hostedSentryEndpoint,
  });
}
