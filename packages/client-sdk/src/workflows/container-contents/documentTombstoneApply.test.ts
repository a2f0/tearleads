import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  holdContainerDocumentTombstones,
  listContainerDocumentTombstoneHolds,
} from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
} from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

const at = "2026-09-20T00:00:00.000Z";
const hold = (containerId: string, documentId = "doc") => ({
  containerId,
  documentId,
  updatedAt: at,
});

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
}

test("applying a verified tombstone repoints only to a local row the head links", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-verified-repoint",
  );
  try {
    await seedDocumentInFolder(execSql);
    await links.replaceDocumentLinks(execSql, "doc", [
      "folder",
      "listed-only",
      "verified-row",
    ]);
    await holdContainerDocumentTombstones(execSql, [hold("folder")], at);

    await applyContainerDocumentTombstones(execSql, [
      {
        ...hold("folder"),
        accessEpoch: 1,
        linkedContainerIds: ["elsewhere", "verified-row"],
      },
    ]);

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "verified-row",
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "verified-row",
    ]);
    expect(
      await listContainerDocumentTombstoneHolds(execSql, ["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a verified removal with no head-linked local row unplaces the document", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-verified-orphan",
  );
  try {
    await seedDocumentInFolder(execSql);
    // A listing-seeded row the signed head does not link must never become
    // the primary container; the document is recoverable as an orphan instead.
    await links.replaceDocumentLinks(execSql, "doc", [
      "folder",
      "server-chosen",
    ]);

    await applyContainerDocumentTombstones(execSql, [
      {
        ...hold("folder"),
        accessEpoch: 1,
        linkedContainerIds: ["real-destination"],
      },
    ]);

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: null,
    });
    // The listing-seeded row goes with it: the verified head never linked it.
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([]);
  } finally {
    close();
  }
});

test("a primary at a listing-seeded row is repointed even when it is not tombstoned", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-primary-offhead",
  );
  try {
    await seedDocumentInFolder(execSql);
    await links.replaceDocumentLinks(execSql, "doc", [
      "folder",
      "server-chosen",
    ]);
    await documents.relinkPersistedDocument(execSql, {
      accessEpoch: 1,
      containerId: "server-chosen",
      documentId: "doc",
      localId: "doc-local",
    });

    await applyContainerDocumentTombstones(execSql, [
      { ...hold("folder"), accessEpoch: 1, linkedContainerIds: ["moved-to"] },
    ]);

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: null,
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([]);
  } finally {
    close();
  }
});

test("a verified head older than the local document epoch is not applied", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-apply-epoch");
  try {
    await seedDocumentInFolder(execSql);
    await documents.relinkPersistedDocument(execSql, {
      accessEpoch: 5,
      containerId: "folder",
      documentId: "doc",
      localId: "doc-local",
    });

    await applyContainerDocumentTombstones(execSql, [
      { ...hold("folder"), accessEpoch: 4, linkedContainerIds: [] },
    ]);

    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "folder",
    ]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "folder",
    });
  } finally {
    close();
  }
});
