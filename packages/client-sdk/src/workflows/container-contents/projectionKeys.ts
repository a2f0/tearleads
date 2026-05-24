import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type ContainerContentsProjectionUserKeyResolver =
  ProjectionUserKeyResolver;
export type ContainerContentsProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

function containerContentsProjectionRuntime(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionKeyRuntime {
  const projectionRuntime: ContainerContentsProjectionKeyRuntime = {
    apiClient: runtime.apiClient,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };

  return runtime.log
    ? { ...projectionRuntime, log: runtime.log }
    : projectionRuntime;
}

export function createContainerContentsProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    containerContentsProjectionRuntime(runtime),
    "Container contents",
  );
}

export function createContainerContentsDocumentProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    containerContentsProjectionRuntime(runtime),
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
