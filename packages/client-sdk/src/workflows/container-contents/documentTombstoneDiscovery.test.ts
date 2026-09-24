import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  HELD_TOMBSTONE_RETRY_INTERVAL_MS,
  holdContainerDocumentTombstones,
  listContainerDocumentTombstoneHolds,
  listKnownContainerDocumentPlacements,
  listRetryableHeldContainerDocumentTombstones,
  releaseContainerDocumentTombstoneHolds,
} from "../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import { sqlDocumentsPersistence as documents } from "../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "./containerPersistence";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "./documentDiscovery";
import type {
  ContainerDocumentTombstone,
  ContainerDocumentTombstoneHoldStore,
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

/** The production hold store, with every hold immediately due for retry. */
function createHoldStore(
  execSql: ExecSql,
): ContainerDocumentTombstoneHoldStore {
  const clock = { now: Date.parse(at) };
  return {
    holdContainerDocumentTombstones: (tombstones) =>
      holdContainerDocumentTombstones(
        execSql,
        tombstones,
        new Date(clock.now).toISOString(),
      ),
    listHeldContainerDocumentTombstones: (containerIds) => {
      clock.now += HELD_TOMBSTONE_RETRY_INTERVAL_MS + 1_000;
      return listRetryableHeldContainerDocumentTombstones(
        execSql,
        containerIds,
        new Date(clock.now),
      );
    },
    listKnownContainerDocumentPlacements: (placements) =>
      listKnownContainerDocumentPlacements(execSql, placements),
    releaseContainerDocumentTombstoneHolds: (placements) =>
      releaseContainerDocumentTombstoneHolds(execSql, placements),
  };
}

async function seed(execSql: ExecSql) {
  await defaultContainerContentsPersistence.ensureSchema(execSql);
  await documents.ensureSchema(execSql);
  for (const id of ["real-folder", "server-chosen", "other"]) {
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
  return {
    ...createContainerDocumentQueriesFromRuntime({ infra: { execSql } }),
    ...createHoldStore(execSql),
    beginDocumentDiscovery: async () => 1,
    verifyDiscoveredDocuments: async () => ({
      inputs: [],
      commit: async () => true,
    }),
  };
}

type Store = Awaited<ReturnType<typeof seed>>;

function discoverRealFolder(
  store: Store,
  input: {
    tombstones: ContainerDocumentTombstone[];
    verify: ContainerDocumentTombstoneVerifier;
  },
) {
  return discoverContainerDocuments({
    ...store,
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

const visibleIn = async (store: Store, containerId: string) =>
  (
    await store.listContainerItemWindow({
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
    const store = await seed(execSql);

    await discoverRealFolder(store, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "refuted",
          linkedContainerIds: [candidate.containerId],
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
    expect(await visibleIn(store, "real-folder")).toEqual(["doc"]);
    expect(await store.loadContainerDocumentWatermark("real-folder")).toEqual({
      id: "doc",
      updatedAt: at,
    });
  } finally {
    close();
  }
});

test("an unverifiable tombstone hides the placement until a verified head settles it", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-attack-held");
  try {
    const store = await seed(execSql);

    await discoverRealFolder(store, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "unverified",
          tombstone: candidate,
        })),
    });

    // Hidden, but the real placement is retained and nothing was repointed.
    expect(await visibleIn(store, "real-folder")).toEqual([]);
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
    await discoverRealFolder(store, {
      tombstones: [],
      verify: async (candidates) => {
        retried.push([...candidates]);
        return candidates.map((candidate) => ({
          kind: "refuted",
          linkedContainerIds: [candidate.containerId],
          tombstone: candidate,
        }));
      },
    });
    expect(retried).toEqual([[tombstone]]);
    expect(await visibleIn(store, "real-folder")).toEqual(["doc"]);
    expect(
      await listContainerDocumentTombstoneHolds(execSql, ["real-folder"]),
    ).toMatchObject([{ containerId: "real-folder", hidden: false }]);

    // A later verified head that omits the folder applies the removal. The
    // listing-seeded row is not in the head link set either, so it goes too:
    // the document is unplaced, never re-homed into the server-chosen folder.
    await discoverRealFolder(store, {
      tombstones: [tombstone],
      verify: async (candidates) =>
        candidates.map((candidate) => ({
          kind: "verified",
          tombstone: {
            ...candidate,
            accessEpoch: 1,
            linkedContainerIds: ["moved-to"],
          },
        })),
    });
    expect(await links.listLinkedContainerIds(execSql, "doc")).toEqual([]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: null,
    });
    expect(await visibleIn(store, "real-folder")).toEqual([]);
    expect(await visibleIn(store, "server-chosen")).toEqual([]);
    expect(
      await store.hasOrphanedDocuments({ currentOrganizationId: "org-1" }),
    ).toBe(true);
  } finally {
    close();
  }
});

test("all-container discovery retries the holds of every listed container", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-hold-retry-all",
  );
  try {
    const store = await seed(execSql);
    await links.replaceDocumentLinks(execSql, "doc", ["real-folder", "other"]);
    await store.holdContainerDocumentTombstones([
      tombstone,
      { ...tombstone, containerId: "other" },
    ]);

    const retried: ContainerDocumentTombstone[][] = [];
    await discoverAllContainerDocuments({
      ...store,
      containerIds: ["real-folder", "other"],
      listContainerDocuments: async () => ({
        hasMore: false,
        items: [],
        nextWatermark: null,
        tombstones: [],
      }),
      verifyContainerDocumentTombstones: async (candidates) => {
        retried.push([...candidates]);
        return candidates.map((candidate) => ({
          kind: "refuted",
          linkedContainerIds: [candidate.containerId],
          tombstone: candidate,
        }));
      },
    });

    expect(retried).toEqual([
      [{ ...tombstone, containerId: "other" }, tombstone],
    ]);
    expect(
      await listContainerDocumentTombstoneHolds(execSql, [
        "real-folder",
        "other",
      ]),
    ).toMatchObject([
      { containerId: "other", hidden: false },
      { containerId: "real-folder", hidden: false },
    ]);
  } finally {
    close();
  }
});
