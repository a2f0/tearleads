import { resolve } from "node:path";
import {
  nativeSentryBuildEnvironment,
  readSentrySecrets,
} from "./sentryBuildEnvironment";
import { uploadNativeSentryMaps } from "./sentryReleaseArtifacts";
import { nativeSentryRelease } from "./sentryReleaseConfig";
import { nativeSentryCommit } from "./sentryReleaseSource";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const platform = process.argv[2] ?? "";
const { NATIVE_RELEASE_SECRETS_DIR, NATIVE_RELEASE_TIER } = process.env;
const tier = NATIVE_RELEASE_TIER ?? "production";
if (tier !== "staging" && tier !== "production")
  throw new Error("Invalid NATIVE_RELEASE_TIER");
// The Fastlane release lanes read the same folder, including the override.
const secretsDirOverride = NATIVE_RELEASE_SECRETS_DIR?.trim();
const secretsDir = secretsDirOverride
  ? resolve(packageRoot, secretsDirOverride)
  : resolve(repoRoot, ".secrets", tier === "production" ? "prod" : "staging");
const env = {
  ...(await readSentrySecrets(resolve(secretsDir, "shared.env"))),
  ...(await readSentrySecrets(resolve(secretsDir, "app.env"))),
  ...process.env,
};
const dsnName = `SENTRY_${platform.toUpperCase()}_${tier.toUpperCase()}_DSN`;
const commit = env[dsnName] ? nativeSentryCommit(repoRoot) : "";
const { SENTRY_AUTH_TOKEN } = env;
const sentry = nativeSentryRelease(platform, tier, commit, env);
// The upload credential stays in this parent process, including under fastlane.
const build = Bun.spawn(["bun", "run", "build"], {
  cwd: packageRoot,
  env: nativeSentryBuildEnvironment(process.env, sentry),
  stdout: "inherit",
  stderr: "inherit",
});
if ((await build.exited) !== 0) throw new Error("Native web build failed");
if (sentry) {
  await uploadNativeSentryMaps(resolve(packageRoot, "dist"), () => {
    if (nativeSentryCommit(repoRoot) !== sentry.commit) {
      throw new Error("Source revision changed during the native Sentry build");
    }
    return Bun.spawn(
      [
        "bun",
        "run",
        "sentry:cli",
        "sourcemaps",
        "upload",
        "--org",
        sentry.org,
        "--project",
        sentry.project,
        "--release",
        sentry.release,
        "--dist",
        sentry.dist,
        "--url-prefix",
        "app:///assets",
        "--validate",
        "--strict",
        "--wait-for",
        "60",
        "dist/assets",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, SENTRY_AUTH_TOKEN },
        stdout: "inherit",
        stderr: "inherit",
      },
    ).exited;
  });
}
