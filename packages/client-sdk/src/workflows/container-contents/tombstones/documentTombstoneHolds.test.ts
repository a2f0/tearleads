import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  deleteContainerDocumentTombstonePlacementRows,
  DocumentContainerProjectionRepository as Links,
} from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { DocumentMoveIntentRepository } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { ContainerDocumentTombstoneHoldRepository } from "../../../data/persistence/documents/containerDocumentTombstoneHoldRepository";
import {
  HELD_TOMBSTONE_RETRY_INTERVAL_MS,
  heldTombstoneRetryDelayMs,
} from "../../../data/persistence/documents/containerDocumentTombstoneHoldsPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
} from "../../../data/persistence/documents/documentsPersistence";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { defaultContainerContentsPersistence } from "../containerPersistence";
import { createContainerDocumentQueriesFromRuntime } from "../documentQueries";
import {
  saveTestContainer,
  saveTestDocument,
} from "../documentQueries/documentQueries.testFixtures";
import { listContainerContentsDocumentsForContainers } from "../documentQueries/documentSubtreeQueries";

const holds = (execSql: ExecSql) =>
  new ContainerDocumentTombstoneHoldRepository(execSql);
const holdsAt = (execSql: ExecSql, instant: string | number | Date) =>
  new ContainerDocumentTombstoneHoldRepository(
    execSql,
    () => new Date(instant),
  );

const at = "2026-09-20T00:00:00.000Z";
const later = new Date(
  Date.parse(at) + HELD_TOMBSTONE_RETRY_INTERVAL_MS + 1_000,
);
const hold = (containerId: string, documentId = "doc") => ({
  containerId,
  documentId,
  updatedAt: at,
});

/** One held tombstone on "folder", stamped at `at`. */
const holdFolderAt = (execSql: ExecSql) =>
  holdsAt(execSql, at).holdContainerDocumentTombstones([hold("folder")]);

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
  await new Links(execSql).replaceDocumentLinks("doc", ["folder"]);
  return createContainerDocumentQueriesFromRuntime({ infra: { execSql } });
}

async function folderDocumentRows(
  execSql: ExecSql,
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
  const subtree = await listContainerContentsDocumentsForContainers(
    execSql,
    ["folder"],
    { sortDocumentSummaries: true },
  );
  return {
    itemCount: window.totalCount,
    sidebarIds: sidebar.rows.map((row) => row.documentId),
    subtreeIds: subtree.documentSummaries.map((summary) => summary.documentId),
    subtreeLinks: subtree.linkedContainerIdsByDocumentId.get("doc") ?? null,
  };
}

test("a held tombstone hides the placement from every container read without deleting it", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-hides");
  try {
    const readModel = await seedDocumentInFolder(execSql);
    expect(await folderDocumentRows(execSql, readModel)).toEqual({
      itemCount: 1,
      sidebarIds: ["doc"],
      subtreeIds: ["doc"],
      subtreeLinks: ["folder"],
    });

    await holdFolderAt(execSql);

    expect(await folderDocumentRows(execSql, readModel)).toEqual({
      itemCount: 0,
      sidebarIds: [],
      subtreeIds: [],
      subtreeLinks: [],
    });
    expect(await new Links(execSql).listLinkedContainerIds("doc")).toEqual([
      "folder",
    ]);
    expect(await documents.loadDocument(execSql, "doc-local")).toMatchObject({
      containerId: "folder",
    });
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds([
        "folder",
        "other",
      ]),
    ).toMatchObject([
      { attempts: 1, containerId: "folder", documentId: "doc" },
    ]);

    await holds(execSql).refuteContainerDocumentTombstoneHolds([
      { containerId: "folder", documentId: "doc" },
    ]);
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toMatchObject([
      { containerId: "folder", documentId: "doc", hidden: false, attempts: 1 },
    ]);

    expect(await folderDocumentRows(execSql, readModel)).toMatchObject({
      itemCount: 1,
      sidebarIds: ["doc"],
      subtreeIds: ["doc"],
    });
  } finally {
    close();
  }
});

test("a hidden linked placement stays hidden while the primary placement shows", async () => {
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
    await new Links(execSql).replaceDocumentLinks("doc", ["folder", "shared"]);
    const sharedCount = async () =>
      (
        await readModel.listContainerItemWindow({
          containerId: "shared",
          limit: 10,
          offset: 0,
          sort: { direction: "asc", key: "name" },
        })
      ).totalCount;
    expect(await sharedCount()).toBe(1);

    await holdsAt(execSql, at).holdContainerDocumentTombstones([
      hold("shared"),
    ]);

    expect(await sharedCount()).toBe(0);
    // The subtree read hides the held placement even when it is not one of
    // the requested containers, matching the item and sidebar views.
    expect(await folderDocumentRows(execSql, readModel)).toMatchObject({
      itemCount: 1,
      subtreeIds: ["doc"],
      subtreeLinks: ["folder"],
    });
  } finally {
    close();
  }
});

test("a held tombstone is retried after a backoff that doubles per attempt", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-backoff");
  try {
    await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);
    expect(heldTombstoneRetryDelayMs(1)).toBe(HELD_TOMBSTONE_RETRY_INTERVAL_MS);
    expect(heldTombstoneRetryDelayMs(3)).toBe(
      4 * HELD_TOMBSTONE_RETRY_INTERVAL_MS,
    );
    expect(heldTombstoneRetryDelayMs(40)).toBe(
      128 * HELD_TOMBSTONE_RETRY_INTERVAL_MS,
    );

    expect(
      await holdsAt(
        execSql,
        Date.parse(at) + 1_000,
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([]);
    expect(
      await holdsAt(
        execSql,
        later,
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([hold("folder")]);

    // A second failed attempt doubles the wait before the next one.
    const secondAttempt = later.toISOString();
    await holdsAt(execSql, secondAttempt).holdContainerDocumentTombstones([
      hold("folder"),
    ]);
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toMatchObject([{ attempts: 2, updatedAt: secondAttempt }]);
    expect(
      await new ContainerDocumentTombstoneHoldRepository(
        execSql,
        () =>
          new Date(later.getTime() + HELD_TOMBSTONE_RETRY_INTERVAL_MS + 1_000),
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([]);
    expect(
      await new ContainerDocumentTombstoneHoldRepository(
        execSql,
        () =>
          new Date(
            later.getTime() + 2 * HELD_TOMBSTONE_RETRY_INTERVAL_MS + 1_000,
          ),
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([hold("folder")]);
  } finally {
    close();
  }
});

test("a listing that links the placement again releases its hold", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-relisted");
  try {
    const readModel = await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);
    expect((await folderDocumentRows(execSql, readModel)).itemCount).toBe(0);

    await readModel.replaceDocumentLinksBatch([
      { containerIds: ["folder"], documentId: "doc" },
    ]);

    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
    expect((await folderDocumentRows(execSql, readModel)).itemCount).toBe(1);
  } finally {
    close();
  }
});

test("a deferred hold does not advance the retry backoff", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-deferred");
  try {
    await seedDocumentInFolder(execSql);
    await holdsAt(execSql, at).holdContainerDocumentTombstones([
      { ...hold("folder"), deferred: true },
    ]);
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toMatchObject([{ attempts: 0 }]);
    await holdsAt(execSql, later.toISOString()).holdContainerDocumentTombstones(
      [{ ...hold("folder"), deferred: true }],
    );
    // Neither the attempt count nor the last-attempt time advances.
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toMatchObject([{ attempts: 0, updatedAt: at }]);
    expect(
      await holdsAt(
        execSql,
        later,
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([hold("folder")]);
  } finally {
    close();
  }
});

test("deleting the document locally clears its holds", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-delete");
  try {
    await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);

    await documents.deleteDocument(execSql, "doc-local");

    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a placement owned by a pending move intent is never held", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-intent");
  try {
    await seedDocumentInFolder(execSql);
    await new DocumentMoveIntentRepository(execSql).enqueueMoveIntent({
      documentId: "doc",
      id: "intent-1",
      localId: "doc-local",
      replaceLinkedContainers: true,
      sourceContainerId: "folder",
      targetContainerId: "trash",
    });

    await holdFolderAt(execSql);

    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a local move releases the holds on the document it relinks", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-hold-local-move",
  );
  try {
    await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);
    await new DocumentMoveIntentRepository(execSql).enqueueMoveIntent({
      documentId: "doc",
      id: "intent-1",
      localId: "doc-local",
      replaceLinkedContainers: true,
      sourceContainerId: "elsewhere",
      targetContainerId: "folder",
    });

    await new Links(execSql).replaceDocumentLinks("doc", ["folder"], {
      moveIntentId: "intent-1",
    });

    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a hold whose placement is gone is dropped when retried", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-hold-orphan");
  try {
    await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);
    await new Links(execSql).replaceDocumentLinks("doc", []);
    await applyContainerDocumentTombstones(
      execSql,
      [{ ...hold("folder"), accessEpoch: 1, linkedContainerIds: [] }],
      deleteContainerDocumentTombstonePlacementRows,
    );
    await holdFolderAt(execSql);

    expect(
      await holdsAt(
        execSql,
        later,
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([]);
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("only placements with a local link row or primary count as known", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-known-placements",
  );
  try {
    await seedDocumentInFolder(execSql);
    await saveTestDocument({
      containerId: "primary-only",
      documentId: "other",
      execSql,
      id: "other-local",
      title: "Other",
      updatedAt: at,
    });

    expect(
      await holds(execSql).listKnownContainerDocumentPlacements([
        { containerId: "folder", documentId: "doc" },
        { containerId: "never", documentId: "doc" },
        { containerId: "primary-only", documentId: "other" },
        { containerId: "folder", documentId: "missing" },
      ]),
    ).toEqual([
      { containerId: "folder", documentId: "doc" },
      { containerId: "primary-only", documentId: "other" },
    ]);
  } finally {
    close();
  }
});

test("a refuted tombstone stays visible and remains retryable if the head lagged", async () => {
  const { close, execSql } = await createTestExecSql("tombstone-refuted-retry");
  try {
    const readModel = await seedDocumentInFolder(execSql);
    await holdsAt(execSql, at).holdContainerDocumentTombstones([
      { ...hold("folder"), refuted: true },
    ]);
    expect(await folderDocumentRows(execSql, readModel)).toMatchObject({
      itemCount: 1,
      sidebarIds: ["doc"],
      subtreeIds: ["doc"],
    });
    expect(
      await holdsAt(
        execSql,
        later,
      ).listRetryableHeldContainerDocumentTombstones(["folder"]),
    ).toEqual([hold("folder")]);
    await holdsAt(execSql, later.toISOString()).holdContainerDocumentTombstones(
      [hold("folder")],
    );
    expect(await folderDocumentRows(execSql, readModel)).toMatchObject({
      itemCount: 1,
    });
    await applyContainerDocumentTombstones(
      execSql,
      [
        {
          ...hold("folder"),
          accessEpoch: 2,
          linkedContainerIds: [],
        },
      ],
      deleteContainerDocumentTombstonePlacementRows,
    );
    expect(await new Links(execSql).listLinkedContainerIds("doc")).toEqual([]);
    expect(
      await holds(execSql).listContainerDocumentTombstoneHolds(["folder"]),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("a document with every placement held remains available in orphan recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "tombstone-held-orphan-recovery",
  );
  try {
    const readModel = await seedDocumentInFolder(execSql);
    await holdFolderAt(execSql);
    expect(
      await readModel.hasOrphanedDocuments({ currentOrganizationId: null }),
    ).toBe(true);
    const window = await readModel.listContainerItemWindow({
      containerId: null,
      currentOrganizationId: null,
      limit: 10,
      offset: 0,
      sort: { direction: "asc", key: "name" },
    });
    expect(
      window.rows.flatMap((row) =>
        row.itemKind === "document" ? [row.documentId] : [],
      ),
    ).toEqual(["doc"]);
    expect(
      await readModel.loadOrphanedDocumentSummary({
        localId: "doc-local",
        currentOrganizationId: null,
      }),
    ).toMatchObject({ documentId: "doc" });
    await new Links(execSql).replaceDocumentLinks("doc", ["folder", "visible"]);
    expect(
      await readModel.hasOrphanedDocuments({ currentOrganizationId: null }),
    ).toBe(false);
  } finally {
    close();
  }
});
