import type {
  IConfiguration,
  ICruiseOptions,
  OutputType,
} from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

export const dependencyCruiserEntryPoints = [
  "packages/api/src",
  "packages/app/src",
  "packages/client-sdk/src",
  "packages/ui/src",
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
