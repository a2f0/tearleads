import { workspaceRegistry, workspaceSourcePaths } from "./workspaceRegistry";

function packageSourceRootPattern(sourcePath: string): string {
  return `^${sourcePath}/`;
}

// Shared file-name patterns. Single source of truth for the architecture lint
// harness (scripts/lintArchitecture.ts), the subsystem manifest
// (scripts/subsystems.ts), and the dependency-cruiser config (which consumes the
// `.source` string form).
export const productionSourceFilePattern = /\.[cm]?[tj]sx?$/;
export const testFilePattern = /\.test\.[tj]sx?$/;

export const packageSourcePath = workspaceSourcePaths;

export const packageSourceRoot = Object.fromEntries(
  Object.entries(packageSourcePath).map(([key, sourcePath]) => [
    key,
    packageSourceRootPattern(sourcePath),
  ]),
) as { readonly [Key in keyof typeof packageSourcePath]: string };

export const allPackageSourceRoots: readonly string[] =
  Object.values(packageSourceRoot);

export const deploymentTargetSourceRoots = workspaceRegistry
  .filter((workspace) => workspace.role === "deployment-target")
  .map((workspace) => packageSourceRoot[workspace.key]);

export const dependencyCruiserEntryPoints = workspaceRegistry.map(
  (workspace) => workspaceSourcePaths[workspace.key],
);
