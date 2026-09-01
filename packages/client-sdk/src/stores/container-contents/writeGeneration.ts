import type { ContainerContentsStoreRuntime } from "./syncAgent";
import type { ContainerContentsStoreState } from "./types";

export type ContainerWriteGuard = () => boolean;

export function didContainerWriteRuntimeChange(
  previousRuntime: ContainerContentsStoreRuntime,
  currentRuntime: ContainerContentsStoreRuntime,
): boolean {
  return (
    previousRuntime.adoptRootContainer !== currentRuntime.adoptRootContainer ||
    previousRuntime.apiClient !== currentRuntime.apiClient ||
    previousRuntime.auth.defaultOrganizationId !==
      currentRuntime.auth.defaultOrganizationId ||
    previousRuntime.auth.isAuthenticated !==
      currentRuntime.auth.isAuthenticated ||
    previousRuntime.auth.organizationId !==
      currentRuntime.auth.organizationId ||
    previousRuntime.auth.userId !== currentRuntime.auth.userId ||
    previousRuntime.crypto.encapsulationKeyPair !==
      currentRuntime.crypto.encapsulationKeyPair ||
    previousRuntime.crypto.signingFingerprint !==
      currentRuntime.crypto.signingFingerprint ||
    previousRuntime.crypto.signingKeyPair !==
      currentRuntime.crypto.signingKeyPair ||
    previousRuntime.infra.blobStore !== currentRuntime.infra.blobStore ||
    previousRuntime.infra.dbStatus !== currentRuntime.infra.dbStatus ||
    previousRuntime.infra.documentProjectors !==
      currentRuntime.infra.documentProjectors ||
    previousRuntime.infra.execSql !== currentRuntime.infra.execSql ||
    previousRuntime.resolveTrustedUserIdentity !==
      currentRuntime.resolveTrustedUserIdentity ||
    previousRuntime.state.containerId !== currentRuntime.state.containerId ||
    previousRuntime.state.domainScope !== currentRuntime.state.domainScope
  );
}

export function captureContainerWriteGeneration(
  state: ContainerContentsStoreState,
): ContainerWriteGuard {
  const lifecycleGeneration = state.lifecycleGeneration;
  const persistence = state.persistence;
  const runtime = state.runtime;
  const writeGeneration = state.writeGeneration;
  return () =>
    state.lifecycleGeneration === lifecycleGeneration &&
    state.persistence === persistence &&
    state.writeGeneration === writeGeneration &&
    !didContainerWriteRuntimeChange(runtime, state.runtime);
}
