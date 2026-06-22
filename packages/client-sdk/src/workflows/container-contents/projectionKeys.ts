import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";

export type ContainerContentsProjectionUserKeyResolver =
  ProjectionUserKeyResolver;
type ProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export interface ContainerContentsProjectionKeyRuntime {
  readonly apiClient: ProjectionKeyRuntime["apiClient"];
  readonly auth: {
    readonly userId?: string | null | undefined;
  };
  readonly crypto: {
    readonly encapsulationKeyPair?: ProjectionKeyRuntime["encapsulationKeyPair"];
    readonly signingFingerprint?: ProjectionKeyRuntime["signingFingerprint"];
    readonly signingKeyPair?: ProjectionKeyRuntime["signingKeyPair"];
  };
  readonly util?: {
    readonly log?: ProjectionKeyRuntime["log"];
  };
}

type ContainerContentsProjectionRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

function containerContentsProjectionRuntime(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionRuntime {
  const projectionRuntime: ContainerContentsProjectionRuntime = {
    apiClient: runtime.apiClient,
    encapsulationKeyPair: runtime.crypto.encapsulationKeyPair ?? null,
    signingFingerprint: runtime.crypto.signingFingerprint ?? null,
    signingKeyPair: runtime.crypto.signingKeyPair ?? null,
    userId: runtime.auth.userId ?? null,
  };

  return runtime.util?.log
    ? { ...projectionRuntime, log: runtime.util.log }
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
    previousRuntime.crypto.encapsulationKeyPair !==
      nextRuntime.crypto.encapsulationKeyPair ||
    previousRuntime.crypto.signingFingerprint !==
      nextRuntime.crypto.signingFingerprint ||
    previousRuntime.crypto.signingKeyPair !==
      nextRuntime.crypto.signingKeyPair ||
    previousRuntime.auth.userId !== nextRuntime.auth.userId
  );
}
