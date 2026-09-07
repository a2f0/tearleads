import type { IConfiguration } from "dependency-cruiser";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";
import { workspaceRegistry } from "./workspaceRegistry";

export const runtimeDependencyRule = {
  name: "not-to-dev-dep",
  severity: "error",
  comment:
    "Runtime modules in every workspace must declare value imports as production dependencies.",
  from: {
    path: workspaceRegistry
      .filter((workspace) => workspace.role !== "test-support")
      .map((workspace) => packageSourceRoot[workspace.key]),
    // Declaration files and documented test seams are not runtime modules.
    // Other architecture rules still apply to these files.
    pathNot: [
      testFilePattern.source,
      "\\.d\\.[cm]?ts$",
      "\\.(testFixtures|testUtils)\\.[tj]sx?$",
      "/(test|tests|testFixtures|testUtils)/",
      "/(testFixtures|testUtils)\\.[tj]sx?$",
    ],
  },
  to: {
    dependencyTypes: ["npm-dev"],
    dependencyTypesNot: ["type-only"],
    pathNot: "node_modules/@types/",
  },
} satisfies NonNullable<IConfiguration["forbidden"]>[number];
