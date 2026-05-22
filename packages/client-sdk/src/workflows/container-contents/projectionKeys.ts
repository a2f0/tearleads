import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type ContainerContentsProjectionUserKeyResolver =
  ProjectionUserKeyResolver;
export type ContainerContentsProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export function createContainerContentsProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Container contents");
}

export function createContainerContentsDocumentProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    runtime,
    "Container document projections",
  );
}

export function didContainerContentsProjectionKeyRuntimeChange(
  previousRuntime: ContainerContentsProjectionKeyRuntime,
  nextRuntime: ContainerContentsProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}
