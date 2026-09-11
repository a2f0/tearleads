import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";

export interface ElectrobunSentryInput {
  dsn: string | undefined;
  environment: string | undefined;
  commit: string | undefined;
  origin: string;
  scriptUrl: string;
}

export function resolveElectrobunSentryConfig(
  input: ElectrobunSentryInput,
): SentryConfig | undefined {
  if (
    !input.dsn ||
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
  // The renderer is served by src/bun/index.ts on its pinned loopback origin
  // (the port is fixed so OPFS and localStorage survive a relaunch), from a flat
  // Bun HTML bundle whose only script is chunk-<hash>.js. Reject anything else —
  // devtools frames, extension scripts, a future nested asset layout — rather
  // than widening the transmitted allowlist to a directory.
  if (
    script.origin !== input.origin ||
    !/^\/chunk-[a-z0-9]+\.js$/u.test(script.pathname)
  )
    return undefined;
  return {
    dsn: input.dsn,
    origin: input.origin,
    scriptPath: script.pathname,
    environment: input.environment,
    release: `tearleads-electrobun@${input.commit}`,
    dist: `${input.environment}-app`,
  };
}
