import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
  holdContainerDocumentTombstones,
  listHeldContainerDocumentTombstones,
  releaseContainerDocumentTombstoneHolds,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

const at = "2026-09-20T00:00:00.000Z";

async function seedDocumentInFolder(execSql: ExecSql) {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await documents.ensureSchema(execSql);
  await saveTestContainer({
    execSql,
    id: "folder",
    name: "Folder",
    parentId: null,
    timestamp: at,
  });
  await saveTestDocument({
    containerId: "folder",
    documentId: "doc",
    execSql,
    id: "doc-local",
    title: "Held note",
    updatedAt: at,
  });
  await links.replaceDocumentLinks(execSql, "doc", ["folder"]);
  return createContainerDocumentQueriesFromRuntime({ infra: { execSql } });
}

async function folderDocumentRows(
  readModel: ReturnType<typeof createContainerDocumentQueriesFromRuntime>,
) {
  const window = await readModel.listContainerItemWindow({
    containerId: "folder",
    limit: 10,
    offset: 0,
    sort: { direction: "asc", key: "name" },
  });
  const sidebar = await readModel.listContainerDocumentSidebarWindow({
    containerId: "folder",
    limit: 10,
    offset: 0,
  });
  return {
    itemCount: window.totalCount,
    items: window.rows.filter((row) => row.itemKind === "document"),
    sidebarCount: sidebar.totalCount,
    sidebarIds: sidebar.rows.map((row) => row.documentId),
  };
}

test("a held tombstone hides the placement without deleting it, and release restores it", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-hides");
  try {
    const readModel = await seedDocumentInFolder(execSql);
    expect(await folderDocumentRows(readModel)).toMatchObject({
      itemCount: 1,
      sidebarIds: ["doc"],
    });

    await holdContainerDocumentTombstones(execSql, [
      { containerId: "folder", documentId: "doc", updatedAt: at },
    ]);

    expect(await folderDocumentRows(readModel)).toEqual({
      itemCount: 0,
      items: [],
      sidebarCount: 0,
      sidebarIds: [],
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "folder",
    ]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "folder",
    });
    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder", "other"]),
    ).toEqual([{ containerId: "folder", documentId: "doc", updatedAt: at }]);

    await releaseContainerDocumentTombstoneHolds(execSql, [
      { containerId: "folder", documentId: "doc" },
    ]);

    expect(await folderDocumentRows(readModel)).toMatchObject({
      itemCount: 1,
      sidebarIds: ["doc"],
    });
    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a hidden linked placement stays hidden when the primary container differs", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-linked");
  try {
    const readModel = await seedDocumentInFolder(execSql);
    await saveTestContainer({
      execSql,
      id: "shared",
      name: "Shared",
      parentId: null,
      timestamp: at,
    });
    await links.replaceDocumentLinks(execSql, "doc", ["folder", "shared"]);
    const sharedRows = () =>
      readModel.listContainerItemWindow({
        containerId: "shared",
        limit: 10,
        offset: 0,
        sort: { direction: "asc", key: "name" },
      });
    expect((await sharedRows()).totalCount).toBe(1);

    await holdContainerDocumentTombstones(execSql, [
      { containerId: "shared", documentId: "doc", updatedAt: at },
    ]);

    expect((await sharedRows()).totalCount).toBe(0);
    expect((await folderDocumentRows(readModel)).itemCount).toBe(1);
  } finally {
    close();
  }
});

test("applying a verified tombstone repoints only to a container the head links", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-verified-repoint",
  );
  try {
    await seedDocumentInFolder(execSql);
    // A listing-seeded row the signed head does not link must never become
    // the primary container.
    await links.replaceDocumentLinks(execSql, "doc", [
      "folder",
      "server-chosen",
    ]);
    await holdContainerDocumentTombstones(execSql, [
      { containerId: "folder", documentId: "doc", updatedAt: at },
    ]);

    await applyContainerDocumentTombstones(execSql, [
      {
        containerId: "folder",
        documentId: "doc",
        linkedContainerIds: ["real-destination"],
        updatedAt: at,
      },
    ]);

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "real-destination",
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "server-chosen",
    ]);
    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("applying a verified tombstone prefers a local row the head links", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-verified-local",
  );
  try {
    await seedDocumentInFolder(execSql);
    await links.replaceDocumentLinks(execSql, "doc", [
      "folder",
      "listed-only",
      "verified-row",
    ]);

    await applyContainerDocumentTombstones(execSql, [
      {
        containerId: "folder",
        documentId: "doc",
        linkedContainerIds: ["elsewhere", "verified-row"],
        updatedAt: at,
      },
    ]);

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "verified-row",
    });
  } finally {
    close();
  }
});

test("a placement owned by a pending move intent is never held", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-intent");
  try {
    await seedDocumentInFolder(execSql);
    await intents.enqueueMoveIntent(execSql, {
      documentId: "doc",
      id: "intent-1",
      localId: "doc-local",
      replaceLinkedContainers: true,
      sourceContainerId: "folder",
      targetContainerId: "trash",
    });

    await holdContainerDocumentTombstones(execSql, [
      { containerId: "folder", documentId: "doc", updatedAt: at },
    ]);

    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a hold whose link row is gone is dropped on the next listing", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-orphan");
  try {
    await seedDocumentInFolder(execSql);
    await holdContainerDocumentTombstones(execSql, [
      { containerId: "folder", documentId: "doc", updatedAt: at },
    ]);
    await links.replaceDocumentLinks(execSql, "doc", []);

    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder"]),
    ).toEqual([]);
    await links.replaceDocumentLinks(execSql, "doc", ["folder"]);
    expect(
      await listHeldContainerDocumentTombstones(execSql, ["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});
