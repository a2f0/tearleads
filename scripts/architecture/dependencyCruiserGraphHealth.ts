const knownNpmEdge = {
  module: "@noble/post-quantum/ml-kem.js",
  source: "packages/crypto/src/encapsulation/generateKeyPair.ts",
} as const;

const knownWorkspaceEdge = {
  module: "@tearleads/encoding",
  resolved: "packages/encoding/src/index.ts",
  source: "packages/crypto/src/blobEnvelope.ts",
} as const;

interface GraphDependency {
  readonly dependencyTypes: readonly string[];
  readonly matchesDoNotFollow?: boolean;
  readonly module: string;
  readonly resolved: string;
}

interface GraphModule {
  readonly dependencies: readonly GraphDependency[];
  readonly source: string;
}

interface DependencyCruiserGraph {
  readonly modules: readonly GraphModule[];
}

export function findDependencyCruiserGraphHealthViolations(
  graph: DependencyCruiserGraph,
  expectedSourcePaths: readonly string[],
): string[] {
  const violations: string[] = [];

  for (const sourcePath of expectedSourcePaths) {
    if (
      !graph.modules.some((module) =>
        module.source.startsWith(`${sourcePath}/`),
      )
    ) {
      violations.push(`${sourcePath}: no modules were cruised`);
    }
  }

  const npmSentinelFound = graph.modules.some(
    (module) =>
      module.source === knownNpmEdge.source &&
      module.dependencies.some(
        (dependency) =>
          dependency.module === knownNpmEdge.module &&
          dependency.dependencyTypes.includes("npm") &&
          dependency.matchesDoNotFollow === true,
      ),
  );
  if (!npmSentinelFound) {
    violations.push(
      `${knownNpmEdge.source}: expected terminal npm edge to ${knownNpmEdge.module}`,
    );
  }

  const workspaceSentinelFound = graph.modules.some(
    (module) =>
      module.source === knownWorkspaceEdge.source &&
      module.dependencies.some(
        (dependency) =>
          dependency.module === knownWorkspaceEdge.module &&
          dependency.resolved === knownWorkspaceEdge.resolved,
      ),
  );
  if (!workspaceSentinelFound) {
    violations.push(
      `${knownWorkspaceEdge.source}: expected workspace edge to ${knownWorkspaceEdge.resolved}`,
    );
  }

  const clientSdkBuildModule = graph.modules.find((module) =>
    module.source.startsWith("packages/client-sdk/dist/"),
  );
  if (clientSdkBuildModule) {
    violations.push(
      `${clientSdkBuildModule.source}: client-sdk imports must resolve to source, not build output`,
    );
  }

  return violations;
}
