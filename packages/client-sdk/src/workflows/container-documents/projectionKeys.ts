import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type ContainerDocumentsProjectionUserKeyResolver =
  ProjectionUserKeyResolver;
export type ContainerDocumentsProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export function createContainerDocumentsProjectionUserKeyResolver(
  runtime: ContainerDocumentsProjectionKeyRuntime,
): ContainerDocumentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Container documents");
}

export function createContainerDocumentsDocumentProjectionUserKeyResolver(
  runtime: ContainerDocumentsProjectionKeyRuntime,
): ContainerDocumentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    runtime,
    "Container document projections",
  );
}

export function didContainerDocumentsProjectionKeyRuntimeChange(
  previousRuntime: ContainerDocumentsProjectionKeyRuntime,
  nextRuntime: ContainerDocumentsProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}
