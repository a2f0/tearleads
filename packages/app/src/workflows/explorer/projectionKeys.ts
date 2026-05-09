import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type ExplorerProjectionUserKeyResolver = ProjectionUserKeyResolver;
export type ExplorerProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export function createExplorerProjectionUserKeyResolver(
  runtime: ExplorerProjectionKeyRuntime,
): ExplorerProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Explorer");
}

export function createExplorerDocumentProjectionUserKeyResolver(
  runtime: ExplorerProjectionKeyRuntime,
): ExplorerProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Explorer documents");
}

export function didExplorerProjectionKeyRuntimeChange(
  previousRuntime: ExplorerProjectionKeyRuntime,
  nextRuntime: ExplorerProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}
