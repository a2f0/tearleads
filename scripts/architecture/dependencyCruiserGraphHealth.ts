const knownNpmEdge = {
  module: "@noble/post-quantum/ml-kem.js",
  source: "packages/crypto/src/encapsulation/generateKeyPair.ts",
} as const;

const knownWorkspaceEdge = {
  module: "@tearleads/encoding",
  resolved: "packages/encoding/src/index.ts",
  source: "packages/crypto/src/keying/accessEvent.ts",
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
  graph: DependencyCruiserGraph | null | undefined,
  expectedSourcePaths: readonly string[],
): string[] {
  if (!graph || !Array.isArray(graph.modules)) {
    return ["dependency-cruiser returned an invalid or empty graph"];
  }

  const modules: readonly GraphModule[] = graph.modules;
  const violations: string[] = [];

  for (const sourcePath of expectedSourcePaths) {
    if (!modules.some((module) => module.source.startsWith(`${sourcePath}/`))) {
      violations.push(`${sourcePath}: no modules were cruised`);
    }
  }

  const npmSentinelFound = modules.some(
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

  const workspaceSentinelFound = modules.some(
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

  const clientSdkBuildModule = modules.find((module) =>
    module.source.startsWith("packages/client-sdk/dist/"),
  );
  if (clientSdkBuildModule) {
    violations.push(
      `${clientSdkBuildModule.source}: client-sdk imports must resolve to source, not build output`,
    );
  }

  return violations;
}
