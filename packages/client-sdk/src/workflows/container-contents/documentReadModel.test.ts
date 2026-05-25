import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  createContainerDocumentReadModelFromRuntime,
  listDocumentRuntimeTargetsForContainerSubtreeFromRuntime,
  primeDocumentsForContainerSubtree,
} from "./documentReadModel";
import {
  createContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState,
} from "./syncState";

async function saveTestContainer(input: {
  execSql: Parameters<
    typeof defaultContainerContentsPersistence.saveContainer
  >[0];
  id: string;
  name: string;
  parentId: string | null;
  timestamp: string;
}) {
  await defaultContainerContentsPersistence.saveContainer(
    input.execSql,
    {
      icon: null,
      id: input.id,
      metadataDocumentId: null,
      name: input.name,
      organizationId: "org-1",
      parentId: input.parentId,
    },
    null,
    { localUpdatedAt: input.timestamp },
  );
}

async function saveTestDocument(input: {
  containerId: string;
  documentId: string | null;
  execSql: Parameters<typeof sqlDocumentsPersistence.saveDocument>[0];
  id: string;
  kind?: "note" | "drivers_license" | "credit_card";
  title: string;
  updatedAt: string;
}) {
  await sqlDocumentsPersistence.saveDocument(
    input.execSql,
    {
      accessEpoch: 1,
      containerId: input.containerId,
      documentId: input.documentId,
      documentKind: input.kind ?? "note",
      id: input.id,
      loroSnapshot: "",
      text: input.title,
      title: input.title,
    },
    { updatedAt: input.updatedAt },
  );
}

test("createContainerDocumentReadModelFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-read-model-runtime",
  );
  try {
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);
    const watermark = {
      id: "document-1",
      updatedAt: "2026-05-09T00:00:00.000Z",
    };

    await readModel.saveContainerDocumentWatermark("container-1", watermark);

    expect(
      await readModel.loadContainerDocumentWatermark("container-1"),
    ).toEqual(watermark);
  } finally {
    close();
  }
});

test("listContainerItemWindow pages and sorts container rows from SQLite", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-container-item-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestContainer({
      execSql,
      id: "root-container",
      name: "Root",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "child-container",
      name: "Archive",
      parentId: "root-container",
      timestamp: "2026-05-02T00:00:00.000Z",
    });
    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-1",
      execSql,
      id: "song-1",
      title: "Older song",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-2",
      execSql,
      id: "song-2",
      kind: "credit_card",
      title: "Newest song",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: "root-container",
        limit: 2,
        offset: 0,
        sort: { direction: "desc", key: "modified" },
      }),
    ).resolves.toEqual({
      totalCount: 3,
      rows: [
        {
          containerId: "root-container",
          createdAt: "2026-05-04T00:00:00.000Z",
          documentId: "remote-song-2",
          documentKind: "credit_card",
          itemKind: "document",
          localId: "song-2",
          name: "Newest song",
          syncState: syncedContainerDocumentObjectSyncState,
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        {
          containerId: "root-container",
          createdAt: "2026-05-03T00:00:00.000Z",
          documentId: "remote-song-1",
          documentKind: "note",
          itemKind: "document",
          localId: "song-1",
          name: "Older song",
          syncState: syncedContainerDocumentObjectSyncState,
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: "root-container",
        limit: 2,
        offset: 0,
        sort: { direction: "asc", key: "type" },
      }),
    ).resolves.toMatchObject({
      totalCount: 3,
      rows: [
        {
          documentKind: "credit_card",
          itemKind: "document",
          localId: "song-2",
        },
        {
          id: "child-container",
          itemKind: "container",
          name: "Archive",
        },
      ],
    });
  } finally {
    close();
  }
});

test("listContainerItemWindow includes documents linked to the selected container", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-linked-container-item-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestContainer({
      execSql,
      id: "private-container",
      name: "Private",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "shared-container",
      name: "Shared",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestDocument({
      containerId: "private-container",
      documentId: "remote-shared-song",
      execSql,
      id: "shared-song",
      title: "Linked song",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinks("remote-shared-song", [
      "private-container",
      "shared-container",
    ]);

    await expect(
      readModel.listContainerItemWindow({
        containerId: "shared-container",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [
        {
          containerId: "shared-container",
          itemKind: "document",
          localId: "shared-song",
          name: "Linked song",
        },
      ],
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: "private-container",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [
        {
          containerId: "private-container",
          itemKind: "document",
          localId: "shared-song",
          name: "Linked song",
        },
      ],
    });
  } finally {
    close();
  }
});

test("listContainerDocumentSidebarWindow pages container document rows from SQLite", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-sidebar-document-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-1",
      execSql,
      id: "song-1",
      title: "Older song",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-2",
      execSql,
      id: "song-2",
      kind: "drivers_license",
      title: "Newest song",
      updatedAt: "2026-05-04T00:00:00.000Z",
    });
    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-3",
      execSql,
      id: "song-3",
      title: "Middle song",
      updatedAt: "2026-05-03T12:00:00.000Z",
    });

    await expect(
      readModel.listContainerDocumentSidebarWindow({
        containerId: "root-container",
        limit: 2,
        offset: 0,
      }),
    ).resolves.toEqual({
      totalCount: 3,
      rows: [
        {
          containerId: "root-container",
          documentId: "remote-song-2",
          documentKind: "drivers_license",
          localId: "song-2",
          syncState: syncedContainerDocumentObjectSyncState,
          title: "Newest song",
          updatedAt: "2026-05-04T00:00:00.000Z",
        },
        {
          containerId: "root-container",
          documentId: "remote-song-3",
          documentKind: "note",
          localId: "song-3",
          syncState: syncedContainerDocumentObjectSyncState,
          title: "Middle song",
          updatedAt: "2026-05-03T12:00:00.000Z",
        },
      ],
    });

    await expect(
      readModel.listContainerDocumentSidebarWindow({
        containerId: "root-container",
        limit: 2,
        offset: 2,
      }),
    ).resolves.toMatchObject({
      totalCount: 3,
      rows: [
        {
          localId: "song-1",
          title: "Older song",
        },
      ],
    });
  } finally {
    close();
  }
});

test("listContainerDocumentSidebarWindow includes linked documents for a sidebar container", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-linked-sidebar-document-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestDocument({
      containerId: "private-container",
      documentId: "remote-shared-song",
      execSql,
      id: "shared-song",
      title: "Linked song",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinks("remote-shared-song", [
      "private-container",
      "shared-container",
    ]);

    await expect(
      readModel.listContainerDocumentSidebarWindow({
        containerId: "shared-container",
        limit: 10,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      totalCount: 1,
      rows: [
        {
          containerId: "shared-container",
          localId: "shared-song",
          title: "Linked song",
        },
      ],
    });
  } finally {
    close();
  }
});

test("loadDocumentSummary loads a single document projection by local id", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-load-document-summary",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-1",
      execSql,
      id: "song-1",
      title: "Song 1",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });

    await expect(readModel.loadDocumentSummary("song-1")).resolves.toEqual({
      accessStateHash: null,
      containerId: "root-container",
      documentId: "remote-song-1",
      documentKind: "note",
      id: "song-1",
      title: "Song 1",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await expect(readModel.loadDocumentSummary("missing-song")).resolves.toBe(
      null,
    );
  } finally {
    close();
  }
});

test("loadDocumentSyncState summarizes pending document work", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-load-document-sync-state",
  );
  try {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);

    await saveTestDocument({
      containerId: "root-container",
      documentId: "remote-song-1",
      execSql,
      id: "song-1",
      title: "Song 1",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await sqlDocumentsPersistence.enqueuePendingUpdate(execSql, {
      localId: "song-1",
      partialEndVersionVector: "{}",
      partialStartVersionVector: "{}",
      sourceVersionVector: null,
      updateData: "update",
    });
    await sqlDocumentsPersistence.savePendingAttachment(execSql, {
      byteLength: 123_456,
      localId: "song-1",
      mimeType: "audio/mpeg",
      name: "song.mp3",
      slotId: "song-file",
      storageKey: "local-blob-1",
    });

    await expect(readModel.loadDocumentSyncState("song-1")).resolves.toEqual(
      createContainerDocumentObjectSyncState({
        pendingAttachmentBytes: 123_456,
        pendingAttachmentCount: 1,
        pendingUpdateCount: 1,
      }),
    );
    await expect(readModel.loadDocumentSyncState("missing-song")).resolves.toBe(
      null,
    );
  } finally {
    close();
  }
});

test("listDocumentRuntimeTargetsForContainerSubtreeFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-runtime-targets",
  );
  try {
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "private-container",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["private-container", "shared-root"],
      },
    ]);
    await readModel.replaceDocumentLinks("remote-document-1", [
      "private-container",
      "shared-root",
    ]);

    const targets =
      await listDocumentRuntimeTargetsForContainerSubtreeFromRuntime({
        containersById: new Map([
          [
            "shared-root",
            {
              container: {
                id: "shared-root",
                parentId: null,
              },
            },
          ],
        ]),
        rootContainerId: "shared-root",
        runtime,
      });

    expect(targets).toEqual([
      {
        documentId: "remote-document-1",
        localId: "remote-document-1",
        runtimeContainerId: "shared-root",
      },
    ]);
  } finally {
    close();
  }
});

test("primeDocumentsForContainerSubtree primes matching document stores", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-subtree-prime",
  );
  try {
    const runtime = { execSql };
    const readModel = createContainerDocumentReadModelFromRuntime(runtime);
    await readModel.upsertDiscoveredDocuments([
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-1",
        containerId: "private-container",
        createdAt: "2026-05-09T00:00:00.000Z",
        documentId: "remote-document-1",
        linkedContainerIds: ["private-container", "shared-child"],
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-2",
        containerId: "private-container-2",
        createdAt: "2026-05-09T00:00:01.000Z",
        documentId: "remote-document-2",
        linkedContainerIds: ["private-container-2", "shared-child"],
      },
      {
        accessEpoch: 1,
        accessStateHash: "access-state-hash-3",
        containerId: "unrelated-container",
        createdAt: "2026-05-09T00:00:02.000Z",
        documentId: "remote-document-3",
        linkedContainerIds: ["unrelated-container"],
      },
    ]);
    await readModel.replaceDocumentLinks("remote-document-1", [
      "private-container",
      "shared-child",
    ]);
    await readModel.replaceDocumentLinks("remote-document-2", [
      "private-container-2",
      "shared-child",
    ]);
    await readModel.replaceDocumentLinks("remote-document-3", [
      "unrelated-container",
    ]);

    const primedStores: Array<{
      documentId: string | null;
      localId: string;
      runtime: { containerId: string };
    }> = [];
    const createdRuntimeContainerIds: string[] = [];
    const syncRequests: string[] = [];
    const primedCount = await primeDocumentsForContainerSubtree({
      containersById: new Map([
        [
          "shared-root",
          {
            container: {
              id: "shared-root",
              parentId: null,
            },
          },
        ],
        [
          "shared-child",
          {
            container: {
              id: "shared-child",
              parentId: "shared-root",
            },
          },
        ],
        [
          "unrelated-container",
          {
            container: {
              id: "unrelated-container",
              parentId: null,
            },
          },
        ],
      ]),
      host: {
        createDocumentRuntime: (containerId) => {
          createdRuntimeContainerIds.push(containerId);
          return { containerId };
        },
        primeDocumentStore: (input) => {
          primedStores.push(input);
          return {
            requestSync: () => {
              syncRequests.push(input.localId);
            },
          };
        },
      },
      rootContainerId: "shared-root",
      runtime,
    });

    primedStores.sort((left, right) =>
      left.localId.localeCompare(right.localId),
    );

    expect(primedCount).toBe(2);
    expect(createdRuntimeContainerIds).toEqual(["shared-child"]);
    expect(primedStores).toEqual([
      {
        documentId: "remote-document-1",
        localId: "remote-document-1",
        runtime: {
          containerId: "shared-child",
        },
      },
      {
        documentId: "remote-document-2",
        localId: "remote-document-2",
        runtime: {
          containerId: "shared-child",
        },
      },
    ]);
    expect(syncRequests.sort()).toEqual([
      "remote-document-1",
      "remote-document-2",
    ]);
  } finally {
    close();
  }
});
