import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
} from "@tearleads/diagnostics/config";

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
 * Resolve the public renderer defines for a desktop release tier. An unset tier
 * is an ordinary local build and reports nothing; a configured tier with a
 * missing or malformed DSN stops the build rather than silently shipping a
 * desktop app that looks instrumented and is not.
 */
export function desktopSentryReleaseEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  tier: string | undefined,
  commit: string,
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
  if (!tier) return buildEnv;
  if (!isSentryEnvironment(tier))
    throw new Error("Desktop release tier must be staging or production");
  const dsn = env[`SENTRY_ELECTROBUN_${tier.toUpperCase()}_DSN`];
  if (!isHostedSentryDsn(dsn ?? "") || !isSentryCommit(commit)) {
    throw new Error(
      "Configured desktop Sentry release requires a hosted DSN and a full commit",
    );
  }
  return {
    ...buildEnv,
    BUN_PUBLIC_SENTRY_ELECTROBUN_COMMIT: commit,
    BUN_PUBLIC_SENTRY_ELECTROBUN_DSN: dsn,
    BUN_PUBLIC_SENTRY_ELECTROBUN_ENVIRONMENT: tier,
  };
}
