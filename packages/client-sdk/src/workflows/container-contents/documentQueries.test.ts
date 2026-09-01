import { expect, test } from "bun:test";
import { createDocument } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence,
} from "../../data/persistence/documents/documentsPersistence";
import { persistDocumentState } from "../documents/persistence";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";
import { syncedContainerDocumentObjectSyncState } from "./syncState";

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

test("listContainerItemWindow includes allowlisted system container rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-visible-system-container-items",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);
    const contactsSystemSlot =
      "sys_v1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const trashSystemSlot =
      "sys_v1_ccccccccccccccccccccccccccccccccccccccccccc";
    const rosterSystemSlot =
      "sys_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await saveTestContainer({
      execSql,
      id: "root-container",
      name: "Root",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "archive-container",
      name: "Archive",
      parentId: "root-container",
      timestamp: "2026-05-02T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "contacts-container",
      name: "Contacts",
      parentId: "root-container",
      systemSlot: contactsSystemSlot,
      timestamp: "2026-05-03T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      icon: "trash",
      id: "trash-container",
      name: "Trash",
      parentId: "root-container",
      systemSlot: trashSystemSlot,
      timestamp: "2026-05-04T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "roster-profile-container",
      name: "Roster Profiles",
      parentId: "root-container",
      systemSlot: rosterSystemSlot,
      timestamp: "2026-05-05T00:00:00.000Z",
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: "root-container",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
        visibleSystemSlots: [contactsSystemSlot, trashSystemSlot],
      }),
    ).resolves.toMatchObject({
      totalCount: 3,
      rows: [
        { id: "archive-container", itemKind: "container", name: "Archive" },
        { id: "contacts-container", itemKind: "container", name: "Contacts" },
        {
          icon: "trash",
          id: "trash-container",
          itemKind: "container",
          name: "Trash",
        },
      ],
    });
  } finally {
    close();
  }
});

test("listContainerItemWindow includes shared system container rows by foreign name", async () => {
  const { close, execSql } = await createTestExecSql(
    "containerContents-shared-system-container-items",
  );
  try {
    await defaultContainerContentsPersistence.ensureSchema(execSql);
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const runtime = { infra: { execSql } };
    const readModel = createContainerDocumentQueriesFromRuntime(runtime);

    await saveTestContainer({
      execSql,
      id: "shared-root-container",
      name: "Shared Root",
      organizationId: "owner-org",
      parentId: null,
      timestamp: "2026-05-01T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "archive-container",
      name: "Archive",
      organizationId: "owner-org",
      parentId: "shared-root-container",
      timestamp: "2026-05-02T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "peer-contacts-container",
      name: "Contacts",
      organizationId: "owner-org",
      parentId: "shared-root-container",
      systemSlot: "owner-contacts-slot",
      timestamp: "2026-05-03T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "peer-trash-container",
      name: "Trash",
      organizationId: "owner-org",
      parentId: "shared-root-container",
      systemSlot: "owner-trash-slot",
      timestamp: "2026-05-04T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "peer-roster-profile-container",
      name: "Roster Profiles",
      organizationId: "owner-org",
      parentId: "shared-root-container",
      systemSlot: "owner-roster-slot",
      timestamp: "2026-05-05T00:00:00.000Z",
    });
    await saveTestContainer({
      execSql,
      id: "same-org-trash-spoof",
      name: "Trash",
      organizationId: "viewer-org",
      parentId: "shared-root-container",
      systemSlot: "same-org-spoof-slot",
      timestamp: "2026-05-06T00:00:00.000Z",
    });

    await expect(
      readModel.listContainerItemWindow({
        containerId: "shared-root-container",
        currentOrganizationId: "viewer-org",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
        visibleForeignSystemContainerNames: ["Contacts", "Trash"],
        visibleSystemSlots: ["viewer-contacts-slot", "viewer-trash-slot"],
      }),
    ).resolves.toMatchObject({
      totalCount: 3,
      rows: [
        { id: "archive-container", itemKind: "container", name: "Archive" },
        {
          id: "peer-contacts-container",
          itemKind: "container",
          name: "Contacts",
        },
        { id: "peer-trash-container", itemKind: "container", name: "Trash" },
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

test("listContainerItemWindow drops every duplicate projection when a document is unlinked from a container", async () => {
  // Identity recovery can rematerialize a second local projection row for the
  // same server document before convergence completes. When a peer then moves
  // that document out of a container (a source-container unlink tombstone), the
  // container it left must no longer surface it through ANY projection row.
  const { close, execSql } = await createTestExecSql(
    "containerContents-tombstone-duplicate-projection",
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

    // Two local rows for the same server document, both primary=root.
    await saveTestDocument({
      execSql,
      id: "recovered-local",
      documentId: "contact-1",
      containerId: "root",
      title: "Ada Lovelace",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    await saveTestDocument({
      execSql,
      id: "rematerialized-local",
      documentId: "contact-1",
      containerId: "root",
      title: "Ada Lovelace",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    await readModel.replaceDocumentLinksBatch([
      { documentId: "contact-1", containerIds: ["root"] },
    ]);

    await applyContainerDocumentTombstones(execSql, [
      {
        containerId: "root",
        documentId: "contact-1",
        updatedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);

    const rootWindow = await readModel.listContainerItemWindow({
      containerId: "root",
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    expect(
      rootWindow.rows.filter((row) => row.itemKind === "document"),
    ).toEqual([]);
    expect(rootWindow.totalCount).toBe(0);
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
