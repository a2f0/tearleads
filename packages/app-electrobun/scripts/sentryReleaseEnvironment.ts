import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";
import { sourceMapDirEnvName } from "../src/rendererEnvironment";

export async function readDesktopSentrySecrets(
  path: string,
): Promise<Record<string, string | undefined>> {
  try {
    // Bun's node:util parser accepts exported, quoted assignments. Keep shell
    // expansion out of this loader; Sentry credentials are literal values.
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return {};
    throw error;
  }
}

/**
 * Resolve the public renderer and main-process defines for a desktop release
 * tier, plus the directory where the packaging hook stages source maps. An
 * unset tier is an ordinary local build and reports nothing; a configured tier
 * with a missing or malformed DSN, or without a staging directory, stops the
 * build rather than silently shipping a desktop app that looks instrumented and
 * is not.
 */
export function desktopSentryReleaseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  tier: string | undefined,
  commit: string,
  sourceMapDir?: string,
): Record<string, string | undefined> {
  // Drop every inherited Sentry name, public or private: a shell that already
  // exported the web or native release configuration must not route desktop
  // events into another project, and the upload token has no business in a
  // renderer bundle.
  const buildEnv = { ...env };
  for (const name of Object.keys(buildEnv)) {
    if (name.startsWith("SENTRY_") || name.includes("BUN_PUBLIC_SENTRY_"))
      delete buildEnv[name];
  }
  delete buildEnv[sourceMapDirEnvName];
  if (!tier) return buildEnv;
  if (!isSentryEnvironment(tier))
    throw new Error("Desktop release tier must be staging or production");
  const dsn = env[`SENTRY_ELECTROBUN_${tier.toUpperCase()}_DSN`];
  if (!isHostedSentryDsn(dsn ?? "") || !isSentryCommit(commit)) {
    throw new Error(
      "Configured desktop Sentry release requires a hosted DSN and a full commit",
    );
  }
  if (!sourceMapDir)
    throw new Error(
      "Configured desktop Sentry release requires a source-map staging directory",
    );
  return {
    ...buildEnv,
    [sourceMapDirEnvName]: sourceMapDir,
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: dsn,
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: tier,
  };
}

export interface DesktopSentryUpload {
  org: string;
  project: string;
  token: string;
  environment: "staging" | "production";
}

// Checked before building, so a release that cannot upload its maps never runs
// the build.
export function desktopSentryUpload(
  env: Readonly<Record<string, string | undefined>>,
  tier: string,
): DesktopSentryUpload {
  if (!isSentryEnvironment(tier))
    throw new Error("Desktop release tier must be staging or production");
  const { SENTRY_ORG: org, SENTRY_AUTH_TOKEN: token } = env;
  const project = env[`SENTRY_ELECTROBUN_${tier.toUpperCase()}_PROJECT`];
  if (!org || !project || !token)
    throw new Error(
      "Configured desktop Sentry release requires SENTRY_ORG, SENTRY_ELECTROBUN_<TIER>_PROJECT, and SENTRY_AUTH_TOKEN",
    );
  return { org, project, token, environment: tier };
}
