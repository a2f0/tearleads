import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import {
  createContainerDocumentObjectSyncState,
  syncedContainerDocumentObjectSyncState,
} from "../syncState";
import { saveTestDocument } from "./documentQueries.testFixtures";
import { listDocumentRuntimeTargetsForContainerSubtreeFromRuntime } from "./documentSubtreeQueries";
import { createContainerDocumentQueriesFromRuntime } from "./index";

test("listContainerDocumentSidebarWindow pages container document rows from SQLite", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-sidebar-document-window",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

    await saveTestDocument({
      containerId: "private-container",
      documentId: "remote-shared-song",
      execSql,
      id: "shared-song",
      title: "Linked song",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinksBatch([
      {
        documentId: "remote-shared-song",
        containerIds: ["private-container", "shared-container"],
      },
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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

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
      effectiveAccessLevel: "read",
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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

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
      contentSha256: "0".repeat(64),
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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
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
    await readModel.replaceDocumentLinksBatch([
      {
        documentId: "remote-document-1",
        containerIds: ["private-container", "shared-root"],
      },
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
