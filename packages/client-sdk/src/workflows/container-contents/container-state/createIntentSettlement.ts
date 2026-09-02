import type {
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
  CreatedRemoteContainerState,
} from "./types";

export async function settleContainerCreateIntent(input: {
  alreadySettled: boolean;
  intent: ContainerCreateIntentSyncInput["intent"];
  isCurrent: () => boolean;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  state: ContainerCreateIntentSyncState;
  supersededMovePreviousParentId: string | null;
}): Promise<boolean> {
  if (input.alreadySettled) return input.isCurrent();
  if (!input.isCurrent()) return false;
  const settleRevision = input.state.persistence.markCreateIntentRevisionSynced;
  if (!settleRevision) return false;
  const settled = await settleRevision(input.state.runtime.infra.execSql, {
    containerId: input.intent.containerId,
    expectedIntentId: input.intent.id,
    expectedUpdatedAt: input.intent.updatedAt,
    remoteContainerId: input.remoteContainerId,
    remoteMetadataAccessStateHash: input.remoteMetadataAccessStateHash,
    remoteMetadataDocumentId: input.remoteMetadataDocumentId,
    stillCurrent: input.isCurrent,
    supersededMovePreviousParentId: input.supersededMovePreviousParentId,
  });
  return settled && input.isCurrent();
}

export async function settlePersistedContainerCreateIntent(input: {
  alreadySettled: boolean;
  created: CreatedRemoteContainerState;
  intent: ContainerCreateIntentSyncInput["intent"];
  isCurrent: () => boolean;
  state: ContainerCreateIntentSyncState;
}): Promise<"abandoned" | "intent-superseded" | null> {
  const settled = await settleContainerCreateIntent({
    alreadySettled: input.alreadySettled,
    intent: input.intent,
    isCurrent: input.isCurrent,
    remoteContainerId: input.created.containerId,
    remoteMetadataAccessStateHash: input.created.accessManifestHash,
    remoteMetadataDocumentId: input.created.metadataDocumentId,
    state: input.state,
    supersededMovePreviousParentId: input.created.parentId,
  });
  return settled ? null : input.isCurrent() ? "intent-superseded" : "abandoned";
}
