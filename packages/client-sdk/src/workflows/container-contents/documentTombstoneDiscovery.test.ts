import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import { discoverContainerDocuments } from "./documentDiscovery";
import type {
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneVerifier,
} from "./documentDiscoveryTypes";
import { createContainerDocumentQueriesFromRuntime } from "./documentQueries";
import {
  saveTestContainer,
  saveTestDocument,
} from "./documentQueries.testFixtures";

const at = "2026-09-20T00:00:00.000Z";
const tombstone: ContainerDocumentTombstone = {
  containerId: "real-folder",
  documentId: "doc",
  updatedAt: at,
};

async function seed(execSql: ExecSql) {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await documents.ensureSchema(execSql);
  for (const id of ["real-folder", "server-chosen"]) {
    await saveTestContainer({
      execSql,
      id,
      name: id,
      parentId: null,
      timestamp: at,
    });
  }
  await saveTestDocument({
    containerId: "real-folder",
    documentId: "doc",
    execSql,
    id: "doc-local",
    title: "Note",
    updatedAt: at,
  });
  // The listing already seeded a bogus link row for the server-chosen folder.
  await links.replaceDocumentLinks(execSql, "doc", [
    "real-folder",
    "server-chosen",
  ]);
  return createContainerDocumentQueriesFromRuntime({ infra: { execSql } });
}

function discoverRealFolder(
  readModel: ReturnType<typeof createContainerDocumentQueriesFromRuntime>,
  input: {
    tombstones: ContainerDocumentTombstone[];
    verify: ContainerDocumentTombstoneVerifier;
  },
) {
  return discoverContainerDocuments({
    ...readModel,
    containerId: "real-folder",
    listContainerDocuments: async () => ({
      hasMore: false,
      items: [],
      nextWatermark: { id: "doc", updatedAt: at },
      tombstones: input.tombstones,
    }),
    verifyContainerDocumentTombstones: input.verify,
  });
}

const visibleIn = async (
  readModel: ReturnType<typeof createContainerDocumentQueriesFromRuntime>,
  containerId: string,
) =>
  (
    await readModel.listContainerItemWindow({
      containerId,
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    })
  ).rows
    .filter((row) => row.itemKind === "document")
    .map((row) => row.documentId);

test("a listing tombstone the signed head still links cannot re-home the document", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-attack-refuted",
  );
  try {
    const readModel = await seed(execSql);

    await discoverRealFolder(readModel, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "refuted",
          tombstone: candidate,
        })),
    });

    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "real-folder",
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "real-folder",
      "server-chosen",
    ]);
    expect(await visibleIn(readModel, "real-folder")).toEqual(["doc"]);
    expect(
      await readModel.loadContainerDocumentWatermark("real-folder"),
    ).toEqual({ id: "doc", updatedAt: at });
  } finally {
    close();
  }
});

test("an unverifiable tombstone hides the placement until a verified head settles it", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-attack-held");
  try {
    const readModel = await seed(execSql);

    await discoverRealFolder(readModel, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "unverified",
          tombstone: candidate,
        })),
    });

    // Hidden, but the real placement is retained and nothing was repointed.
    expect(await visibleIn(readModel, "real-folder")).toEqual([]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "real-folder",
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "real-folder",
      "server-chosen",
    ]);

    // The next discovery of the folder retries the hold with no new
    // tombstones; a verified head that still links the folder releases it.
    const retried: ContainerDocumentTombstone[][] = [];
    await discoverRealFolder(readModel, {
      tombstones: [],
      verify: async (candidates) => {
        retried.push([...candidates]);
        return candidates.map((candidate) => ({
          kind: "refuted",
          tombstone: candidate,
        }));
      },
    });
    expect(retried).toEqual([[tombstone]]);
    expect(await visibleIn(readModel, "real-folder")).toEqual(["doc"]);

    // A later verified head that omits the folder applies the removal and
    // repoints to the head's link, not the listing-seeded row.
    await discoverRealFolder(readModel, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "verified",
          tombstone: { ...candidate, linkedContainerIds: ["moved-to"] },
        })),
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([
      "server-chosen",
    ]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "moved-to",
    });
    expect(await visibleIn(readModel, "real-folder")).toEqual([]);
  } finally {
    close();
  }
});
