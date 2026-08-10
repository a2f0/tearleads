import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { exportAllUpdates } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createContainerMetadataDocument,
  getDefaultContainerName,
  readContainerMetadataValue,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import { loadLocalContainerStates } from "./localState";
import {
  createContainerContentsPersistence,
  createContainerRecord,
  type SaveContainerCall,
} from "./metadata.testFixtures";
import { syncedContainerDocumentObjectSyncState } from "./syncState";

const execSql: ExecSql = async () => [];
const runtime = { infra: { execSql } };

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];

async function saveSyncedStoredContainer(input: {
  execSql: ExecSql;
  id: string;
  metadataName: string;
  parentId: string | null;
  storedName: string;
  syncedAt: string;
}) {
  const metadataDocumentId = `${input.id}-metadata-document`;
  const doc = await createContainerMetadataDocument(input.id);
  writeContainerMetadataValue(doc, {
    icon: null,
    name: input.metadataName,
  });
  const record: ContainerMetadataRecord = {
    accessEpoch: 1,
    accessStateHash: `${input.id}-access-hash`,
    contentKeyBundle: `${input.id}-content-key-bundle`,
    documentId: metadataDocumentId,
    documentKekTargets: `${input.id}-document-kek-targets`,
    documentManifestBundle: `${input.id}-document-manifest-bundle`,
    id: input.id,
    lastCommitLsn: `${input.id}-commit-lsn`,
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
    snapshotEndVersion: "",
  };

  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      icon: null,
      id: input.id,
      effectiveAccessLevel: "admin",
      metadataDocumentId,
      name: input.storedName,
      organizationId: "org-1",
      parentId: input.parentId,
    },
    record,
    {
      localUpdatedAt: input.syncedAt,
      serverTimestamps: {
        createdAt: input.syncedAt,
        updatedAt: input.syncedAt,
      },
    },
  );
}

test("loadLocalContainerStates materializes metadata records and pending updates", async () => {
  const container = createContainerRecord({
    icon: "folder",
    id: "container-1",
    name: "Local folder",
    parentId: null,
  });
  const savedContainers: SaveContainerCall[] = [];
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];

  const [containerState] = await loadLocalContainerStates({
    persistence: createContainerContentsPersistence({
      pendingUpdates,
      savedContainers,
      storedContainers: [{ container, record: null }],
    }),
    runtime,
  });
  if (!containerState) {
    throw new Error("Expected container state to be loaded");
  }

  expect(containerState.container).toEqual(container);
  expect(containerState.record).toMatchObject({
    accessEpoch: 1,
    accessStateHash: null,
    documentId: null,
    id: container.id,
    lastCommitLsn: null,
  });
  expect(
    readContainerMetadataValue(
      containerState.doc,
      getDefaultContainerName(container.parentId),
    ),
  ).toEqual({
    icon: "folder",
    name: "Local folder",
  });
  expect(savedContainers).toEqual([
    {
      container,
      execSql,
      record: containerState.record,
    },
  ]);
  expect(pendingUpdates).toHaveLength(1);
  expect(pendingUpdates[0]?.execSql).toBe(execSql);
  expect(pendingUpdates[0]?.input.containerId).toBe(container.id);
});

test("loadLocalContainerStates replays metadata snapshots into containers", async () => {
  const container = createContainerRecord({
    icon: null,
    id: "container-2",
    localUpdatedAt: "2026-05-01T00:00:00.000Z",
    metadataDocumentId: "metadata-document-2",
    name: "Stale name",
    parentId: "parent-1",
    serverUpdatedAt: "2026-05-01T00:00:00.000Z",
  });
  const doc = await createContainerMetadataDocument(container.id);
  writeContainerMetadataValue(doc, {
    icon: "briefcase",
    name: "Snapshot name",
  });
  const record: ContainerMetadataRecord = {
    accessEpoch: 7,
    accessStateHash: "access-hash",
    documentId: container.metadataDocumentId,
    id: container.id,
    lastCommitLsn: "commit-1",
    metadataUpdates: bytesToBase64(exportAllUpdates(doc)),
    snapshotEndVersion: "",
    contentKeyBundle: "content-key-bundle",
    documentKekTargets: "document-kek-targets",
    documentManifestBundle: "document-manifest-bundle",
  };
  const savedContainers: SaveContainerCall[] = [];
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];

  const [containerState] = await loadLocalContainerStates({
    persistence: createContainerContentsPersistence({
      pendingUpdates,
      savedContainers,
      storedContainers: [{ container, record }],
    }),
    runtime,
  });
  if (!containerState) {
    throw new Error("Expected container state to be loaded");
  }

  expect(containerState.container).toEqual({
    ...container,
    icon: "briefcase",
    name: "Snapshot name",
  });
  expect(containerState.record).toBe(record);
  expect(savedContainers).toEqual([
    {
      container: containerState.container,
      execSql,
      options: { localUpdatedAt: "2026-05-01T00:00:00.000Z" },
      record,
    },
  ]);
  expect(pendingUpdates).toEqual([]);
});

test("loadLocalContainerStates keeps replayed remote metadata snapshots synced", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-local-state-replay-synced-metadata",
  );
  try {
    const runtime = { infra: { execSql } };
    const syncedAt = "2026-05-01T00:00:00.000Z";

    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await saveSyncedStoredContainer({
      execSql,
      id: "root-container",
      metadataName: "Root",
      parentId: null,
      storedName: "Root",
      syncedAt,
    });
    await saveSyncedStoredContainer({
      execSql,
      id: "child-container",
      metadataName: "Synced child",
      parentId: "root-container",
      storedName: "Stale child projection",
      syncedAt,
    });

    const loadedStates = await loadLocalContainerStates({
      persistence: defaultContainerContentsPersistence,
      runtime,
    });
    const loadedChild = loadedStates.find(
      (containerState) => containerState.container.id === "child-container",
    );
    expect(loadedChild?.container).toMatchObject({
      localUpdatedAt: syncedAt,
      name: "Synced child",
      serverUpdatedAt: syncedAt,
    });

    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
    await expect(
      readModel.listContainerItemWindow({
        containerId: "root-container",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      }),
    ).resolves.toEqual({
      rows: [
        {
          createdAt: syncedAt,
          id: "child-container",
          icon: null,
          itemKind: "container",
          name: "Synced child",
          syncState: syncedContainerDocumentObjectSyncState,
          updatedAt: syncedAt,
        },
      ],
      totalCount: 1,
    });
  } finally {
    close();
  }
});
