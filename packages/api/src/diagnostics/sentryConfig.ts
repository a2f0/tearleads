import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";

export function resolveApiSentryConfig(input: {
  dsn?: string | undefined;
  environment?: string | undefined;
  commit?: string | undefined;
  sourceRoot: string;
  sourcePaths: readonly string[];
}): SentryConfig | undefined {
  if (
    !input.dsn ||
    !isHostedSentryDsn(input.dsn) ||
    !isSentryEnvironment(input.environment) ||
    !isSentryCommit(input.commit)
  )
    return undefined;
  return {
    dsn: input.dsn,
    environment: input.environment,
    release: `tearleads-api@${input.commit}`,
    dist: input.environment,
    runtime: "api",
    origin: "",
    scriptPath: "",
    serverSourceRoot: input.sourceRoot,
    scriptPaths: new Set(input.sourcePaths),
    budgetResetMs: 60 * 60 * 1000,
  };
}
