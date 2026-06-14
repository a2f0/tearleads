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
    outputType,
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}
