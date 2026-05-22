import type { ProjectionUserKeyResolver } from "../../../data/keyingProjectionVerification";
import type { ContainerContentsPersistence } from "../containerPersistence";
import { persistContainerMetadataStateFromRuntime } from "../metadata";
import type { ContainerState } from "../remoteHydration";
import { shareRemoteContainer, shareRemoteContainerWithGroup } from "./remote";
import type { ContainerWorkflowRuntime, SharedContainerState } from "./types";

export async function shareContainerState(input: {
  accessLevel: "read" | "write" | "admin";
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shared = await shareRemoteContainer({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    recipientUserId: input.recipientUserId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  await input.runtime.cacheReferencedPrincipalPolicies(
    shared.referencedPrincipalHeads,
  );
  input.containerState.container = {
    ...input.containerState.container,
    createdAt: shared.createdAt,
    serverCreatedAt: shared.createdAt,
    serverUpdatedAt: shared.updatedAt,
    updatedAt: shared.updatedAt,
  };

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch: {
      accessEpoch: shared.accessEpoch,
      accessStateHash: shared.accessManifestHash,
      documentId: shared.metadataDocumentId,
      metadataDocumentId: shared.metadataDocumentId,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
    persistence: input.persistence,
    runtime: input.runtime,
  });

  return {
    container: persisted.container,
    record: persisted.record,
  };
}

export async function shareContainerStateWithGroup(input: {
  accessLevel: "read" | "write" | "admin";
  containerState: ContainerState;
  persistence: ContainerContentsPersistence;
  recipientGroupId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  runtime: ContainerWorkflowRuntime;
}): Promise<SharedContainerState | null> {
  const shared = await shareRemoteContainerWithGroup({
    accessLevel: input.accessLevel,
    containerId: input.containerState.container.id,
    recipientGroupId: input.recipientGroupId,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    runtime: input.runtime,
  });

  if (!shared) {
    return null;
  }

  await input.runtime.cacheReferencedPrincipalPolicies(
    shared.referencedPrincipalHeads,
  );
  input.containerState.container = {
    ...input.containerState.container,
    createdAt: shared.createdAt,
    serverCreatedAt: shared.createdAt,
    serverUpdatedAt: shared.updatedAt,
    updatedAt: shared.updatedAt,
  };

  const persisted = await persistContainerMetadataStateFromRuntime({
    metadataState: input.containerState,
    patch: {
      accessEpoch: shared.accessEpoch,
      accessStateHash: shared.accessManifestHash,
      documentId: shared.metadataDocumentId,
      metadataDocumentId: shared.metadataDocumentId,
      contentKeyBundle: null,
      documentKekTargets: null,
      documentManifestBundle: null,
    },
    persistence: input.persistence,
    runtime: input.runtime,
  });

  return {
    container: persisted.container,
    record: persisted.record,
  };
}
