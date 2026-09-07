import type {
  IConfiguration,
  ICruiseOptions,
  OutputType,
} from "dependency-cruiser";

import dependencyCruiserConfig from "../dependency-cruiser.config";

export { dependencyCruiserEntryPoints } from "./dependencySourceRoots";

export function createDependencyCruiserOptions(
  outputType?: OutputType,
): ICruiseOptions {
  const { options = {}, ...ruleSet } =
    dependencyCruiserConfig satisfies IConfiguration;

  return {
    ...options,
    // Manifest-only edits can reuse stale npm classifications in the graph
    // cache. Recompute so dependency declaration checks see the current files.
    cache: false,
    ...(outputType ? { outputType } : {}),
    ruleSet,
    validate: Object.keys(ruleSet).length > 0,
  };
}
