import type { ListContainersResponse } from "@tearleads/validators/response";
import type { ContainerState } from "../types";

export const timestamp = "2026-01-01T00:00:00.000Z";

export function remoteContainer(
  id: string,
  parentId: string | null,
): ListContainersResponse["items"][number] {
  return {
    createdAt: timestamp,
    depth: parentId ? 1 : 0,
    effectiveAccessLevel: "write",
    id,
    metadataAccessEpoch: 1,
    metadataAccessStateHash: `access-${id}`,
    metadataDocumentId: `metadata-${id}`,
    metadataUpdateCount: 0,
    metadataReferencedPrincipals: [],
    organizationId: "organization-1",
    parentId,
    systemSlot: null,
    updatedAt: timestamp,
  };
}

export function existingContainerState(
  id: string,
  parentId: string | null,
): ContainerState {
  const remote = remoteContainer(id, parentId);
  return {
    container: {
      id: remote.id,
      icon: null,
      metadataDocumentId: remote.metadataDocumentId,
      name: id,
      organizationId: remote.organizationId,
      parentId: remote.parentId,
      updatedAt: remote.updatedAt,
    },
    doc: {},
    record: {
      accessEpoch: remote.metadataAccessEpoch,
      accessStateHash: remote.metadataAccessStateHash,
      documentId: remote.metadataDocumentId,
      id: remote.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as unknown as ContainerState;
}
