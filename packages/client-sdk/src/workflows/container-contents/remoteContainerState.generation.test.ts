import { expect, mock, test } from "bun:test";
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

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await Bun.sleep(1);
  }
  throw new Error("condition was not reached");
}

test("reset during insert cannot redirect hydration into the recovered database", async () => {
  const staleExecSql = {};
  const recoveredExecSql = {};
  let resolveDormantRecord: (record: null) => void = () => {
    throw new Error("dormant-record promise was not initialized");
  };
  const loadContainerMetadataRecord = mock(
    (_execSql: unknown) =>
      new Promise<null>((resolve) => {
        resolveDormantRecord = resolve;
      }),
  );
  const saveContainer = mock(async () => {
    throw new Error("stale insert must stop before save");
  });
  const host: RemoteContainerHydrationHost = {
    persistContainerState: async () => {
      throw new Error("stale insert must stop before host persistence");
    },
    updateSnapshot: () => {},
  };
  let current = true;
  const state = {
    containersById: new Map(),
    persistence: {
      loadContainerMetadataRecord,
      saveContainer,
    },
    runtime: { infra: { execSql: staleExecSql } },
  } as unknown as RemoteContainerHydrationState;

  const hydration = upsertRemoteContainerState({
    containerIdsWithPendingMetadataUpdates: new Set(),
    containerIdsWithPendingStructuralIntents: new Set(),
    host,
    isCurrent: () => current,
    remoteContainer,
    state,
  });
  await waitFor(() => loadContainerMetadataRecord.mock.calls.length === 1);

  current = false;
  (state.runtime.infra as { execSql: unknown }).execSql = recoveredExecSql;
  resolveDormantRecord(null);

  await expect(hydration).resolves.toBeNull();
  expect(loadContainerMetadataRecord.mock.calls[0]?.[0]).toBe(staleExecSql);
  expect(saveContainer).not.toHaveBeenCalled();
  expect(state.containersById.size).toBe(0);
});
