import type {
  ContainerCreateIntentSyncInput,
  ContainerCreateIntentSyncState,
} from "./types";

export async function settleContainerCreateIntent(input: {
  intent: ContainerCreateIntentSyncInput["intent"];
  isCurrent: () => boolean;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  state: ContainerCreateIntentSyncState;
  supersededMovePreviousParentId: string;
  createdParentContainerId: string;
  desiredParentContainerId: string;
}): Promise<boolean> {
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
    createdParentContainerId: input.createdParentContainerId,
    desiredParentContainerId: input.desiredParentContainerId,
  });
  return settled && input.isCurrent();
}
