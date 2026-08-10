import type { ContainerState } from "../remoteHydration";

/**
 * Synthetic container state for intent-sync tests. By default the container
 * looks fully synced (remote metadata markers derived from the id); with
 * `synced: false` those markers are empty, so it reads as a container that
 * exists locally but has not synced remotely yet
 * (`hasRemoteContainerMetadataState` is false for it).
 */
export function createTestContainerState(input: {
  id: string;
  organizationId?: string;
  parentId: string | null;
  synced?: boolean;
}): ContainerState {
  const synced = input.synced ?? true;
  return {
    container: {
      effectiveAccessLevel: "admin",
      icon: null,
      id: input.id,
      metadataDocumentId: synced ? `metadata-${input.id}` : "",
      name: input.id,
      organizationId: input.organizationId ?? "organization",
      parentId: input.parentId,
      systemSlot: null,
    },
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: synced ? `access-${input.id}` : "",
      documentId: synced ? `metadata-${input.id}` : "",
      id: `record-${input.id}`,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}
