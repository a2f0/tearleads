import type { IConfiguration } from "dependency-cruiser";

import {
  allPackageSourceRoots,
  deploymentTargetSourceRoots,
  packageSourceRoot,
  testFilePattern,
} from "./dependencySourceRoots";
import { workspaceRegistry } from "./workspaceRegistry";

type ForbiddenRules = NonNullable<IConfiguration["forbidden"]>;

const deploymentTargetIsolationComment =
  "Deployment targets should stay independently launchable and must not import one another.";

const deploymentTargets = workspaceRegistry.filter(
  (workspace) => workspace.role === "deployment-target",
);

const deploymentTargetIsolationRules = deploymentTargets.map(
  (deploymentTarget) => ({
    name: `${deploymentTarget.directory}-does-not-import-other-deployment-targets`,
    severity: "error" as const,
    comment: deploymentTargetIsolationComment,
    from: {
      path: packageSourceRoot[deploymentTarget.key],
      pathNot: testFilePattern.source,
    },
    to: {
      path: deploymentTargets
        .filter((candidate) => candidate.key !== deploymentTarget.key)
        .map((candidate) => packageSourceRoot[candidate.key]),
    },
  }),
) satisfies ForbiddenRules;

export const dependencyCruiserDeploymentRules = [
  {
    name: "deployment-targets-are-not-reusable-libraries",
    severity: "error",
    comment:
      "Deployment target packages should consume shared packages and app facades, not become dependencies of reusable source packages.",
    from: {
      path: allPackageSourceRoots.filter(
        (root) => !deploymentTargetSourceRoots.includes(root),
      ),
      pathNot: testFilePattern.source,
    },
    to: {
      path: deploymentTargetSourceRoots,
    },
  },
  ...deploymentTargetIsolationRules,
] satisfies ForbiddenRules;
