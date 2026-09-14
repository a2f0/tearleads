import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isHostedSentryDsn,
  isSentryCommit,
  isSentryEnvironment,
  type SentryConfig,
} from "@tearleads/diagnostics/config";
import { electrobunSentryDist, electrobunSentryRelease } from "./sentryConfig";

export interface ElectrobunMainSentryInput {
  dsn: string | undefined;
  environment: string | undefined;
  commit: string | undefined;
  moduleUrl: string;
}

// Sentry's node stack parser decodeURI()s every frame filename; compare the
// root in that spelling, or an install directory with a literal %20 would drop
// every frame.
function stackSpelling(path: string): string {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

export function resolveElectrobunMainSentryConfig(
  input: ElectrobunMainSentryInput,
): SentryConfig | undefined {
  if (
    !input.dsn ||
    !isHostedSentryDsn(input.dsn) ||
    !isSentryEnvironment(input.environment) ||
    !isSentryCommit(input.commit)
  )
    return undefined;
  let bundle: string;
  try {
    bundle = fileURLToPath(input.moduleUrl);
  } catch {
    return undefined;
  }
  // The launcher runs the flat Resources/app/bun/index.js bundle. An ASAR temp
  // copy (electrobun-<timestamp>.js), an unbundled source run, or any other
  // layout has no trustworthy frame allowlist.
  const bunDir = dirname(bundle);
  if (basename(bundle) !== "index.js" || basename(bunDir) !== "bun")
    return undefined;
  return {
    dsn: input.dsn,
    environment: input.environment,
    release: electrobunSentryRelease(input.commit),
    dist: electrobunSentryDist(input.environment),
    runtime: "electrobun-main",
    origin: "",
    scriptPath: "",
    serverSourceRoot: stackSpelling(dirname(bunDir)),
    scriptPaths: new Set(["/bun/index.js"]),
    budgetResetMs: 3_600_000,
  };
}
