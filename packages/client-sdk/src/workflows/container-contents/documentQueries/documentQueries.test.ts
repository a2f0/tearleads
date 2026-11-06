import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "../../documents/persistence";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { syncedContainerDocumentObjectSyncState } from "../syncState";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";
import { createContainerDocumentQueriesFromRuntime } from "./index";

test("createContainerDocumentQueriesFromRuntime uses the runtime executor", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-document-queries-runtime",
  );
  try {
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

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
    await saveTestContainer({
      execSql,
      id: "roster-profile-container",
      name: "Roster Profiles",
      parentId: "root-container",
      systemSlot: "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      timestamp: "2026-05-05T00:00:00.000Z",
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
        limit: 10,
        offset: 0,
        sort: { direction: "desc", key: "name" },
      }),
    ).resolves.toMatchObject({
      totalCount: 3,
      rows: [
        {
          id: "child-container",
          itemKind: "container",
          name: "Archive",
        },
        {
          itemKind: "document",
          localId: "song-1",
          name: "Older song",
        },
        {
          itemKind: "document",
          localId: "song-2",
          name: "Newest song",
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
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

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
    await readModel.replaceDocumentLinksBatch([
      {
        documentId: "remote-shared-song",
        containerIds: ["private-container", "shared-container"],
      },
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

test("a container-unmanaged persist cannot resurrect a document in a container it was moved out of", async () => {
  // On a recovery peer the contacts view keeps a living document store whose
  // cached record still points at the source folder the contact was created in.
  // After the contact is moved to Trash (the source-unlink tombstone converges
  // document_projection off the source folder), a background document sync ships
  // content-key/manifest metadata with no container. That persist must NOT
  // re-assert the stale cached source folder onto document_projection, or the
  // contact reappears in the folder it was moved out of.
  const { close, execSql } = await createTestExecSql(
    "containerContents-stale-store-container-resurrection",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

    await saveTestContainer({
      execSql,
      id: "root",
      name: "Root",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "trash",
      name: "Trash",
      parentId: "root",
      timestamp: "2026-05-01T00:00:00.000Z",
    });

    // Post-move converged SQLite state: the contact lives in Trash only.
    await saveTestDocument({
      execSql,
      id: "contact-local",
      documentId: "contact-1",
      containerId: "trash",
      title: "Ada Lovelace",
      updatedAt: "2026-05-03T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinksBatch([
      { documentId: "contact-1", containerIds: ["trash"] },
    ]);

    // The living store still caches the pre-move container (root).
    const persistedRecord = await sqlDocumentsPersistence.loadDocument(
      execSql,
      "contact-local",
    );
    if (!persistedRecord) {
      throw new Error("expected a persisted contact record");
    }
    const staleStoreRecord = { ...persistedRecord, containerId: "root" };

    // A background sync persist: runtime + cached record both stale-root, and the
    // patch carries no container (only content-metadata bookkeeping).
    await persistDocumentState({
      containerId: "root",
      currentDoc: await createDocument("contact-1"),
      currentRecord: staleStoreRecord,
      documentProjectors: [],
      execSql,
      localId: "contact-local",
      patch: { lastCommitLsn: "5" },
      persistence: sqlDocumentsPersistence,
    });

    const rootWindow = await readModel.listContainerItemWindow({
      containerId: "root",
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    expect(
      rootWindow.rows.filter((row) => row.itemKind === "document"),
    ).toEqual([]);

    const trashWindow = await readModel.listContainerItemWindow({
      containerId: "trash",
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    expect(
      trashWindow.rows
        .filter((row) => row.itemKind === "document")
        .map((row) => row.localId),
    ).toEqual(["contact-local"]);
  } finally {
    close();
  }
});
