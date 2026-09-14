import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";
import {
  type ElectrobunSentryTarget,
  isElectrobunSentryTarget,
} from "./sentryTarget";

// The flat Bun HTML bundle's only script; shared by the renderer allowlist and
// release source-map staging.
export const rendererScriptPattern = /^\/chunk-[a-z0-9]+\.js$/u;

export function electrobunSentryRelease(commit: string): string {
  return `tearleads-electrobun@${commit}`;
}

// One dist per tier and build target: the macOS and Linux builds of a commit
// share its release and their app:/// URLs, so only the dist selects each
// build's own source maps.
export function electrobunSentryDist(
  environment: "staging" | "production",
  target: ElectrobunSentryTarget,
): `${typeof environment}-app-${ElectrobunSentryTarget}` {
  return `${environment}-app-${target}`;
}

export interface ElectrobunSentryInput {
  dsn: string | undefined;
  environment: string | undefined;
  commit: string | undefined;
  target: string | undefined;
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
    !isSentryCommit(input.commit) ||
    !isElectrobunSentryTarget(input.target)
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
    !rendererScriptPattern.test(script.pathname)
  )
    return undefined;
  return {
    dsn: input.dsn,
    origin: input.origin,
    scriptPath: script.pathname,
    environment: input.environment,
    release: electrobunSentryRelease(input.commit),
    dist: electrobunSentryDist(input.environment, input.target),
  };
}
