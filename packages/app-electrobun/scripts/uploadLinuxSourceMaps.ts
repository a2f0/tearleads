import { basename, isAbsolute, resolve } from "node:path";
import {
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";
import { isElectrobunSentryTarget } from "../src/diagnostics/sentryTarget";
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
// The target is the one releaseLinux.sh built, never this host's own platform.
// The staged copy came from the container, so it must be exactly the expected
// pairs, as real files, under that target's dist, with the main-process bundle
// built from that commit for that target.
export async function runLinuxSourceMapUpload(options: {
  repoRoot: string;
  tier: string | undefined;
  target: string | undefined;
  commit: string | undefined;
  stagingDir: string | undefined;
  env: Environment;
  endpoint: SentryUploadEndpoint;
}): Promise<void> {
  const { repoRoot, tier, target, commit, stagingDir, env, endpoint } = options;
  assertNoBunLaunchVariables(env);
  if (
    !isSentryEnvironment(tier) ||
    !isElectrobunSentryTarget(target) ||
    !target.startsWith("linux-") ||
    !isSentryCommit(commit) ||
    !stagingDir ||
    !isAbsolute(stagingDir) ||
    basename(stagingDir) !== "sentry-sourcemaps"
  )
    throw new Error(
      "Usage: uploadLinuxSourceMaps.ts <staging|production> <linux-x64|linux-arm64> <full commit> <absolute sentry-sourcemaps directory>",
    );
  if (desktopSentryCommit(repoRoot) !== commit)
    throw new Error(
      "The Linux release commit is not this clean checkout's HEAD; release must not be published",
    );
  const secrets = await readReleaseSecrets(repoRoot, tier, env);
  const uploader = prepareSourceMapUpload(secrets, tier, endpoint);
  const dist = assertStagedSourceMaps(stagingDir, {
    environment: tier,
    target,
  });
  const bundle = await Bun.file(
    resolve(stagingDir, dist, "bun/index.js"),
  ).text();
  if (!bundle.includes(commit) || !bundle.includes(JSON.stringify(target)))
    throw new Error(
      `The staged main-process bundle was not built from the release commit for ${target}`,
    );
  await uploadReleaseSourceMaps({
    uploader,
    repoRoot,
    commit,
    stagingDir,
    target,
  });
}

if (import.meta.main) {
  const [tier, target, commit, stagingDir, ...extra] = process.argv.slice(2);
  if (extra.length > 0)
    throw new Error("uploadLinuxSourceMaps.ts takes exactly four arguments");
  await runLinuxSourceMapUpload({
    repoRoot: resolve(import.meta.dirname, "../../.."),
    tier,
    target,
    commit,
    stagingDir,
    env: process.env,
    endpoint: hostedSentryEndpoint,
  });
}
