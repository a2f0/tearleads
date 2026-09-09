import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";

export interface NativeSentryInput {
  dsn?: string | undefined;
  environment?: string | undefined;
  commit?: string | undefined;
  platform?: string | undefined;
  runtimePlatform: string;
  productionBuild: boolean;
  origin: string;
}

export function resolveNativeSentryConfig(
  input: NativeSentryInput,
  manifest: unknown,
): SentryConfig | undefined {
  if (
    !input.productionBuild ||
    !input.dsn ||
    !isHostedSentryDsn(input.dsn) ||
    !isSentryCommit(input.commit) ||
    !isSentryEnvironment(input.environment) ||
    (input.platform !== "android" && input.platform !== "ios") ||
    input.platform !== input.runtimePlatform
  )
    return undefined;
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("commit" in manifest) ||
    manifest.commit !== input.commit ||
    !("platform" in manifest) ||
    manifest.platform !== input.platform ||
    !("environment" in manifest) ||
    manifest.environment !== input.environment ||
    !("paths" in manifest) ||
    !Array.isArray(manifest.paths)
  )
    return undefined;
  const paths: string[] = [];
  for (const path of manifest.paths) {
    if (
      typeof path !== "string" ||
      !/^\/assets\/[a-zA-Z0-9_.-]+\.js$/u.test(path)
    )
      return undefined;
    paths.push(path);
  }
  if (paths.length === 0) return undefined;
  return {
    dsn: input.dsn,
    environment: input.environment,
    origin: input.origin,
    release: `tearleads-${input.platform}@${input.commit}`,
    dist: `${input.environment}-app`,
    scriptPath: paths[0] ?? "",
    scriptPaths: paths,
  };
}
