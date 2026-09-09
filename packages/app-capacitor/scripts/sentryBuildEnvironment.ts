import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import type { nativeSentryRelease } from "./sentryReleaseConfig";

export async function readSentrySecrets(
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

export function nativeSentryBuildEnvironment(
  env: Record<string, string | undefined>,
  sentry: ReturnType<typeof nativeSentryRelease>,
): Record<string, string | undefined> {
  const buildEnv = { ...env };
  for (const key of Object.keys(buildEnv)) {
    if (key.startsWith("SENTRY_") || key.startsWith("VITE_SENTRY_"))
      delete buildEnv[key];
  }
  return {
    ...buildEnv,
    VITE_SENTRY_DSN: sentry?.dsn ?? "",
    VITE_SENTRY_ENVIRONMENT: sentry?.environment ?? "",
    VITE_SENTRY_COMMIT: sentry?.commit ?? "",
    VITE_SENTRY_PLATFORM: sentry?.platform ?? "",
  };
}
