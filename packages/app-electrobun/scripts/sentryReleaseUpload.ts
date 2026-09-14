import { resolve } from "node:path";
import {
  electrobunSentryDist,
  electrobunSentryRelease,
} from "../src/diagnostics/sentryConfig";
import {
  assertSentryTokenOrganization,
  resolveSentryCliBinary,
  runSentryCli,
  type SentryUploadEndpoint,
  sentryCliUploadUrl,
} from "./sentryCliUpload";
import {
  type DesktopSentryUpload,
  desktopSentryUpload,
  readDesktopSentrySecrets,
} from "./sentryReleaseEnvironment";
import { desktopSentryCommit } from "./sentryReleaseSource";
import {
  desktopSourceMapUploadArgs,
  uploadDesktopSourceMaps,
} from "./sentrySourceMaps";

// The token-holding half of a desktop release, shared by the build wrapper
// (withSentryReleaseEnv.ts) and the Linux host upload (uploadLinuxSourceMaps.ts).

export type Environment = Readonly<Record<string, string | undefined>>;

// Bun options, preload modules and debuggers named by these variables, and the
// DYLD_* libraries Bun's entitlements let macOS load, would run in, or attach
// to, the process that holds the upload token. The release shells and
// buildElectrobun.sh unset the Bun variables before any Bun process starts, and
// /bin/sh drops DYLD_* variables; a process started some other way refuses them.
const bunLaunchVariables = [
  "BUN_OPTIONS",
  "BUN_INSPECT",
  "BUN_INSPECT_CONNECT_TO",
  "BUN_INSPECT_NOTIFY",
  "BUN_INSPECT_PRELOAD",
];

export function assertNoBunLaunchVariables(env: Environment): void {
  const launch = Object.keys(env).filter(
    (name) =>
      env[name] !== undefined &&
      (bunLaunchVariables.includes(name) || name.startsWith("DYLD_")),
  );
  if (launch.length > 0)
    throw new Error(
      `Desktop Sentry releases must not run with ${launch.join(", ")}`,
    );
}

// Bun loads dotenv files, and any --env-file in BUN_OPTIONS, into this process
// before it runs, and a build machine may export another project's settings.
// So every SENTRY_* name, the upload token, organization, project and DSN
// included, comes only from .secrets; the environment supplies everything else.
export async function readReleaseSecrets(
  repoRoot: string,
  tier: string,
  env: Environment,
): Promise<Environment> {
  const ambient = Object.entries(env).filter(
    ([name]) => !name.startsWith("SENTRY_"),
  );
  return {
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
}

export interface SourceMapUploader {
  readonly upload: DesktopSentryUpload;
  readonly binary: string;
  readonly endpoint: SentryUploadEndpoint;
}

// Checked before building or uploading anything, so a release that cannot
// upload its maps stops first.
export function prepareSourceMapUpload(
  secrets: Environment,
  tier: string,
  endpoint: SentryUploadEndpoint,
): SourceMapUploader {
  const upload = desktopSentryUpload(secrets, tier);
  const binary = resolveSentryCliBinary();
  sentryCliUploadUrl(upload.token, endpoint);
  assertSentryTokenOrganization(upload.token, upload.org);
  return { upload, binary, endpoint };
}

// Uploads staging under the release of `commit`, which must still be the clean
// checkout's HEAD, and removes staging whatever happens.
export function uploadReleaseSourceMaps(options: {
  uploader: SourceMapUploader;
  repoRoot: string;
  commit: string;
  stagingDir: string;
}): Promise<void> {
  const { uploader, repoRoot, commit, stagingDir } = options;
  const { upload, binary, endpoint } = uploader;
  return uploadDesktopSourceMaps(stagingDir, () => {
    if (desktopSentryCommit(repoRoot) !== commit)
      throw new Error(
        "Source revision changed during the desktop Sentry release",
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
        directory: stagingDir,
      }),
    });
  });
}
