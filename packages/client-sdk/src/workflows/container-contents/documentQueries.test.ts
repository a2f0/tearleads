import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentsPersistence } from "../../data/persistence/documents/documentsPersistence";
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
        { id: "trash-container", itemKind: "container", name: "Trash" },
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
