import { execFileSync } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { nativeSentryRelease } from "./sentryReleaseConfig";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const platform = process.argv[2] ?? "";
const { NATIVE_RELEASE_TIER } = process.env;
const tier = NATIVE_RELEASE_TIER ?? "production";
if (tier !== "staging" && tier !== "production")
  throw new Error("Invalid NATIVE_RELEASE_TIER");
async function readSecrets(name: string) {
  try {
    return parseEnv(
      await readFile(resolve(repoRoot, ".secrets", name), "utf8"),
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    throw error;
  }
}
const env = {
  ...(await readSecrets("root.env")),
  ...(await readSecrets(tier === "production" ? "prod.env" : "staging.env")),
  ...process.env,
};
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();
const { SENTRY_AUTH_TOKEN } = env;
const sentry = nativeSentryRelease(platform, tier, commit, env);
const buildEnv = { ...process.env };
// Only selected public configuration reaches Vite. The upload credential stays
// in this parent process, including when a release was invoked from fastlane.
for (const key of Object.keys(buildEnv)) {
  if (key.startsWith("SENTRY_") || key.startsWith("VITE_SENTRY_"))
    delete buildEnv[key];
}
Object.assign(buildEnv, {
  VITE_SENTRY_DSN: sentry?.dsn ?? "",
  VITE_SENTRY_ENVIRONMENT: sentry?.environment ?? "",
  VITE_SENTRY_COMMIT: sentry?.commit ?? "",
  VITE_SENTRY_PLATFORM: sentry?.platform ?? "",
});
const build = Bun.spawn(["bun", "run", "build"], {
  cwd: packageRoot,
  env: buildEnv,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await build.exited) !== 0) throw new Error("Native web build failed");
if (sentry) {
  const upload = Bun.spawn(
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
  );
  if ((await upload.exited) !== 0)
    throw new Error(
      "Native source map upload failed; release must not be packaged",
    );
  // These maps contain source code and belong only in the private Sentry project.
  for await (const path of new Bun.Glob("**/*.map").scan(
    resolve(packageRoot, "dist"),
  )) {
    await unlink(resolve(packageRoot, "dist", path));
  }
}
