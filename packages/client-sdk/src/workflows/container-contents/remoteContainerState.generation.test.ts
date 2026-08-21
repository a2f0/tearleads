import { expect, test } from "bun:test";
import { upsertRemoteContainerState } from "./remoteContainerState";
import type {
  ContainerState,
  RemoteContainer,
  RemoteContainerHydrationHost,
  RemoteContainerHydrationState,
} from "./remoteHydration/types";

function createExistingState(): ContainerState {
  return {
    container: {
      icon: null,
      id: "container-1",
      metadataDocumentId: "metadata-old",
      name: "Existing",
      organizationId: "organization-1",
      parentId: "root-1",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    containerWriterProjection: {
      accessEpoch: 1,
    } as unknown as ContainerState["containerWriterProjection"],
    doc: {} as ContainerState["doc"],
    record: {
      accessEpoch: 1,
      accessStateHash: "access-old",
      contentKeyBundle: null,
      documentId: "metadata-old",
      documentKekTargets: null,
      documentManifestBundle: null,
      id: "container-1",
      lastCommitLsn: null,
      metadataUpdates: "",
      snapshotEndVersion: "",
    },
  };
}

const remoteContainer: RemoteContainer = {
  createdAt: "2026-01-01T00:00:00.000Z",
  effectiveAccessLevel: "admin",
  id: "container-1",
  metadataAccessEpoch: 2,
  metadataAccessStateHash: "access-new",
  metadataDocumentId: "metadata-new",
  metadataReferencedPrincipals: [],
  organizationId: "organization-1",
  parentId: "root-2",
  systemSlot: null,
  updatedAt: "2026-02-01T00:00:00.000Z",
};

test("stale existing-container persistence cannot publish after reset", async () => {
  const existingState = createExistingState();
  const state = {
    containersById: new Map([[existingState.container.id, existingState]]),
  } as unknown as RemoteContainerHydrationState;
  let current = true;
  let resolvePersist: (record: ContainerState["record"]) => void = () => {
    throw new Error("persist promise was not initialized");
  };
  let persistedCandidate: ContainerState | null = null;
  const host: RemoteContainerHydrationHost = {
    persistContainerState: (candidate) => {
      persistedCandidate = candidate;
      return new Promise((resolve) => {
        resolvePersist = resolve;
      });
    },
    updateSnapshot: () => {},
  };

  const hydration = upsertRemoteContainerState({
    containerIdsWithPendingMetadataUpdates: new Set(),
    containerIdsWithPendingStructuralIntents: new Set(),
    host,
    isCurrent: () => current,
    remoteContainer,
    state,
  });
  expect(persistedCandidate).not.toBe(existingState);

  current = false;
  resolvePersist(existingState.record);
  await hydration;

  expect(existingState.container.metadataDocumentId).toBe("metadata-old");
  expect(existingState.container.parentId).toBe("root-1");
  expect(existingState.container.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  expect(existingState.containerWriterProjection).not.toBeNull();
});
