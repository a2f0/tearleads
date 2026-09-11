import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  desktopSentryReleaseEnvironment,
  readDesktopSentrySecrets,
} from "./sentryReleaseEnvironment";

// Runs a desktop build command with the tier's public Sentry defines set, then
// execs it — the diagnostics counterpart to scripts/withBuildInfoEnv.sh, which
// stamps build identity. It is a wrapper rather than part of the build script so
// the DSN is selected in one place for both `electrobun build` and the packaged
// renderer rebuild in packageElectrobunAssets.ts.
//
// ELECTROBUN_RELEASE_TIER selects staging or production. Unset is a local build:
// no secrets are read and the renderer keeps its local-only System Monitor
// logging. BUN_PUBLIC_GIT_SHA stays the short display SHA; Sentry needs the full
// one to match an uploaded release.
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
const commit = tier
  ? execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim()
  : "";

const [executable, ...args] = command;
const build = Bun.spawn([executable ?? "", ...args], {
  cwd: process.cwd(),
  env: desktopSentryReleaseEnvironment(secrets, tier, commit),
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await build.exited);
