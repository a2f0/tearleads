import type {
  IConfiguration,
  ICruiseOptions,
  OutputType,
} from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

export const dependencyCruiserEntryPoints = [
  "packages/api-client/src",
  "packages/api-cli/src",
  "packages/api-shared/src",
  "packages/api/src",
  "packages/app-electrobun/src",
  "packages/app-web/src",
  "packages/app/src",
  "packages/bob-and-alice/src",
  "packages/client-sdk/src",
  "packages/crypto/src",
  "packages/encoding/src",
  "packages/loro/src",
  "packages/sqlite-instance/src",
  "packages/sqlite-worker/src",
  "packages/test-utils/src",
  "packages/ui/src",
  "packages/validators/src",
  "packages/website/src",
];

export function createDependencyCruiserOptions(
  outputType: OutputType,
): ICruiseOptions {
  const { options = {}, ...ruleSet } =
    dependencyCruiserConfig satisfies IConfiguration;

  return {
    ...options,
    // Cache the module graph so unchanged runs skip the ~3.5s analysis. The
    // metadata strategy keys off git, so uncommitted edits still invalidate the
    // cache and are re-analyzed. The cache lives under node_modules/.cache, so it
    // is ephemeral in CI (cold each run) and never committed.
    cache: {
      folder: "node_modules/.cache/dependency-cruiser",
      strategy: "metadata",
    },
    outputType,
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}
