import { expect, test } from "bun:test";
import { upsertRemoteContainerState } from "./remoteContainerState";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

const remoteContainer: RemoteContainer = {
  createdAt: "2026-01-01T00:00:00.000Z",
  effectiveAccessLevel: "write",
  id: "container-1",
  metadataAccessEpoch: 1,
  metadataAccessStateHash: "access-1",
  metadataDocumentId: "metadata-1",
  metadataReferencedPrincipals: [],
  organizationId: "organization-1",
  parentId: "parent-1",
  systemSlot: null,
  updatedAt: "2026-01-02T00:00:00.000Z",
};

test("hydration removes the mapped container when persistence observes deletion", async () => {
  const existingState = {
    container: {
      id: remoteContainer.id,
      icon: null,
      metadataDocumentId: remoteContainer.metadataDocumentId,
      name: "Container",
      organizationId: remoteContainer.organizationId,
      parentId: remoteContainer.parentId,
      updatedAt: remoteContainer.createdAt,
    },
    doc: {},
    record: {
      accessEpoch: 1,
      accessStateHash: "access-1",
      documentId: remoteContainer.metadataDocumentId,
      id: remoteContainer.id,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  } as unknown as ContainerState;
  const state = {
    containersById: new Map([[remoteContainer.id, existingState]]),
  } as unknown as RemoteContainerHydrationState;
  const childIdsByParentId = new Map([
    [remoteContainer.parentId as string, new Set([remoteContainer.id])],
  ]);
  let persistedCandidate: ContainerState | null = null;
  let snapshotUpdates = 0;

  const result = await upsertRemoteContainerState({
    childIdsByParentId,
    containerIdsWithPendingMetadataUpdates: new Set(),
    containerIdsWithPendingStructuralIntents: new Set(),
    host: {
      persistContainerState: async (candidate) => {
        persistedCandidate = candidate;
        return { status: "missing" };
      },
      updateSnapshot: () => {
        snapshotUpdates += 1;
      },
    },
    remoteContainer,
    state,
  });

  expect(persistedCandidate).not.toBe(existingState);
  expect(result).toBeNull();
  expect(state.containersById.has(remoteContainer.id)).toBe(false);
  expect(childIdsByParentId.has(remoteContainer.parentId as string)).toBe(
    false,
  );
  expect(snapshotUpdates).toBe(1);
});
