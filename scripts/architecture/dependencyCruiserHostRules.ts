import type { IConfiguration } from "dependency-cruiser";
import {
  allPackageSourceRoots,
  packageSourceRoot,
  testFilePattern,
} from "./dependencySourceRoots";

export const hostDependencyRules = [
  {
    name: "performance-consumes-only-sdk-and-sqlite",
    severity: "error",
    from: {
      path: packageSourceRoot.performance,
      pathNot: testFilePattern.source,
    },
    to: {
      path: allPackageSourceRoots.filter(
        (root) =>
          ![
            packageSourceRoot.performance,
            packageSourceRoot.clientSdk,
            packageSourceRoot.sqliteWorker,
          ].includes(root),
      ),
    },
  },
  {
    name: "performance-consumes-public-sdk-facades",
    severity: "error",
    from: {
      path: packageSourceRoot.performance,
      pathNot: testFilePattern.source,
    },
    to: {
      path: packageSourceRoot.clientSdk,
      pathNot: "^packages/client-sdk/src/(index|sqlite/index)\\.ts$",
    },
  },
  {
    name: "runtime-does-not-depend-on-performance-harness",
    severity: "error",
    comment:
      "Performance experiments consume public runtime APIs; runtime packages never import the harness.",
    from: {
      path: allPackageSourceRoots.filter(
        (root) => root !== packageSourceRoot.performance,
      ),
    },
    to: { path: packageSourceRoot.performance },
  },
  {
    name: "website-does-not-depend-on-app",
    severity: "error",
    comment:
      "The website may share UI through @tearleads/ui, but it must not import the application implementation package.",
    from: { path: packageSourceRoot.website, pathNot: testFilePattern.source },
    to: { path: packageSourceRoot.app },
  },
] satisfies NonNullable<IConfiguration["forbidden"]>;
