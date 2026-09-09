import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";

export interface SentryInput {
  dsn: string | undefined;
  environment: string | undefined;
  commit: string | undefined;
  variant: string | undefined;
  origin: string;
  scriptUrl: string;
}

export function resolveSentryConfig(
  input: SentryInput,
): SentryConfig | undefined {
  // Demo has multiple independent identities on one page. Keep it local, as
  // with development, until it has a scoped integration.
  if (
    !input.dsn ||
    input.variant !== "app" ||
    !isHostedSentryDsn(input.dsn) ||
    !isSentryEnvironment(input.environment) ||
    !isSentryCommit(input.commit)
  )
    return undefined;
  let script: URL;
  try {
    script = new URL(input.scriptUrl);
  } catch {
    return undefined;
  }
  if (
    script.origin !== input.origin ||
    !/^\/chunk-[a-z0-9]+\.js$/u.test(script.pathname)
  )
    return undefined;
  const config: SentryConfig = {
    dsn: input.dsn,
    origin: input.origin,
    scriptPath: script.pathname,
    environment: input.environment,
    release: `tearleads-web@${input.commit}`,
    dist: `${input.environment}-app`,
  };
  return config;
}
