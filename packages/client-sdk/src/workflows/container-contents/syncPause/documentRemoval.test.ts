import { expect, test } from "bun:test";
import { createDocument, encodeVersionVector } from "@tearleads/loro";
import { createTestExecSql } from "@tearleads/test-utils";
import { createDocumentProjectorRegistry } from "../../../data/documents";
import { sqlContainerContentsPersistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import {
  clientSqlTables,
  containers,
  documents,
} from "../../../data/sqlite/schema";
import { remoteResetBatches } from "../../../data/sqlite/sqliteBindBudget";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../../data/sqlite/sqlTableSchema";
import { saveTestSyncedContainer } from "../documentQueries/documentQueries.testFixtures";
import { listPendingWrites } from "../pendingWrites";
import { removeOrganizationContentUnlessPending } from "./documentRemoval";

const UPDATED_AT = "2026-01-01T00:00:00.000Z";

async function placedDocument(
  execSql: ExecSql,
  input: {
    containerId?: string;
    localId: string;
    pendingBaseVersion?: string;
    snapshotEndVersion: string;
  },
): Promise<void> {
  const documentId = `${input.localId}-remote`;
  const containerId = input.containerId ?? "folder";
  await sqlDocumentsPersistence.saveDocument(
    execSql,
    {
      accessEpoch: 1,
      accessStateHash: null,
      containerId,
      documentId,
      documentKind: "note",
      id: input.localId,
      ...(input.pendingBaseVersion === undefined
        ? {}
        : { pendingBaseVersion: input.pendingBaseVersion }),
      snapshotEndVersion: input.snapshotEndVersion,
      text: "",
      title: input.localId,
    },
    { updatedAt: UPDATED_AT },
  );
  await execSql(
    "INSERT INTO document_container_projection (document_id, container_id, updated_at) VALUES (?, ?, ?)",
    [documentId, containerId, UPDATED_AT],
  );
}

/** Fails any statement binding more values than SQLite's default limit. */
function bindBudgetedExecSql(execSql: ExecSql): ExecSql & {
  readonly maxBinds: () => number;
} {
  let maxBinds = 0;
  const bounded = new Proxy(execSql, {
    apply(target, thisArg, args) {
      const bind = args[1];
      const binds = Array.isArray(bind)
        ? bind.length
        : bind && typeof bind === "object"
          ? Object.keys(bind).length
          : 0;
      maxBinds = Math.max(maxBinds, binds);
      if (binds > 999) throw new Error(`SQLite bind limit exceeded: ${binds}`);
      return Reflect.apply(target, thisArg, args);
    },
  });
  return Object.assign(bounded, { maxBinds: () => maxBinds });
}

async function withPausedFolder(
  run: (execSql: ExecSql, versions: readonly [string, string]) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql("sync-pause-removal");
  try {
    await listPendingWrites(execSql);
    await saveTestSyncedContainer({
      execSql,
      id: "folder",
      name: "Folder",
      organizationId: "org-paused",
      timestamp: UPDATED_AT,
    });
    const document = await createDocument("sync-pause-removal");
    document.getText("text").update("first");
    document.commit();
    const first = encodeVersionVector(document);
    document.getText("text").update("second");
    document.commit();
    await run(execSql, [first, encodeVersionVector(document)]);
  } finally {
    close();
  }
}

function remove(
  execSql: ExecSql,
  deletedContainers: string[],
  options: {
    containersCurrent?: boolean;
    openDocuments?: ReadonlySet<string>;
  } = {},
) {
  return removeOrganizationContentUnlessPending({
    containerIds: ["folder"],
    deleteContainers: async (_lockedExecSql, removals) => {
      if (options.containersCurrent === false) return [];
      deletedContainers.push(...removals.map((removal) => removal.containerId));
      return removals.map((removal) => removal.containerId);
    },
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql,
    isDocumentOpen: (localId) => options.openDocuments?.has(localId) ?? false,
    organizationId: "org-paused",
  });
}

test("an edit kept only in the local history tail blocks the removal", async () => {
  await withPausedFolder(async (execSql, [uploaded, edited]) => {
    // Nothing is queued, but the stored content is ahead of what was uploaded:
    // a deferred edit that has not synced.
    await placedDocument(execSql, {
      localId: "deferred-edit",
      pendingBaseVersion: uploaded,
      snapshotEndVersion: edited,
    });
    expect(
      (await listPendingWrites(execSql)).some(
        (item) => item.localId === "deferred-edit",
      ),
    ).toBe(true);
    const deletedContainers: string[] = [];

    expect((await remove(execSql, deletedContainers)).status).toBe(
      "pending-writes",
    );
    expect(deletedContainers).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "deferred-edit"),
    ).not.toBeNull();
  });
});

test("an organization with nothing pending is removed with its documents", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "synced",
      snapshotEndVersion: synced,
    });
    const deletedContainers: string[] = [];

    expect(await remove(execSql, deletedContainers)).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: ["synced"],
      status: "removed",
    });
    expect(deletedContainers).toEqual(["folder"]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "synced"),
    ).toBeNull();
  });
});

test("a document an open store holds keeps the whole organization", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "open-document",
      snapshotEndVersion: synced,
    });
    const deletedContainers: string[] = [];

    expect(
      await remove(execSql, deletedContainers, {
        openDocuments: new Set(["open-document"]),
      }),
    ).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "open-documents",
    });
    // Nothing is detached: the folder and its document stay and keep syncing.
    expect(deletedContainers).toEqual([]);
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "open-document"),
    ).not.toBeNull();
  });
});

test("documents stay when the containers' removal is no longer current", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "kept",
      snapshotEndVersion: synced,
    });

    expect(await remove(execSql, [], { containersCurrent: false })).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "interrupted",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "kept"),
    ).not.toBeNull();
  });
});

function removeWithRealDeletion(
  execSql: ExecSql,
  containerIds: readonly string[],
  isDocumentOpen: (localId: string) => boolean = () => false,
) {
  return removeOrganizationContentUnlessPending({
    containerIds,
    deleteContainers: (lockedExecSql, removals) =>
      sqlContainerContentsPersistence.deleteContainers(lockedExecSql, removals),
    documentProjectors: createDocumentProjectorRegistry([]),
    execSql,
    isDocumentOpen,
    organizationId: "org-paused",
  });
}

test("a document whose store opens mid-removal stays as a detached copy", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    await placedDocument(execSql, {
      localId: "late-edit",
      snapshotEndVersion: synced,
    });
    // A store opens on the document after the removal checked it, while the
    // containers are being removed.
    let checks = 0;
    expect(
      await removeWithRealDeletion(execSql, ["folder"], () => checks++ > 0),
    ).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: [],
      status: "interrupted",
    });

    // A later pass leaves it like any document whose container was lost.
    expect(await removeWithRealDeletion(execSql, [])).toEqual({
      deletedContainerIds: [],
      deletedLocalIds: [],
      status: "removed",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "late-edit"),
    ).not.toBeNull();
  });
});

test("documents already detached before the pause survive its removal", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    // A folder this device lost earlier left its document detached but still
    // attributed to the organization: possibly a copy a recovery still needs.
    await saveTestSyncedContainer({
      execSql,
      id: "lost-folder",
      name: "Lost",
      organizationId: "org-paused",
      timestamp: UPDATED_AT,
    });
    await placedDocument(execSql, {
      containerId: "lost-folder",
      localId: "recovery-copy",
      snapshotEndVersion: synced,
    });
    await sqlContainerContentsPersistence.deleteContainers(execSql, [
      {
        containerId: "lost-folder",
        reason: "access_revoked",
        updatedAt: UPDATED_AT,
      },
    ]);
    await placedDocument(execSql, {
      localId: "synced",
      snapshotEndVersion: synced,
    });

    expect(await removeWithRealDeletion(execSql, ["folder"])).toEqual({
      deletedContainerIds: ["folder"],
      deletedLocalIds: ["synced"],
      status: "removed",
    });
    expect(
      await sqlDocumentsPersistence.loadDocument(execSql, "recovery-copy"),
    ).not.toBeNull();
  });
});

test("a folder with more documents than SQLite binds is removed", async () => {
  await withPausedFolder(async (execSql, [, synced]) => {
    const localIds = Array.from(
      { length: 1_001 },
      (_, index) => `bulk-${index}`,
    );
    for (const localId of localIds) {
      await placedDocument(execSql, { localId, snapshotEndVersion: synced });
    }
    const boundedExecSql = bindBudgetedExecSql(execSql);

    const removal = await removeWithRealDeletion(boundedExecSql, ["folder"]);

    expect(removal.status).toBe("removed");
    expect(removal.deletedLocalIds).toHaveLength(localIds.length);
  });
});

test("a large organization is removed within SQLite's bind budget", async () => {
  const { close, execSql } = await createTestExecSql("sync-pause-removal-bulk");
  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await listPendingWrites(execSql);
    const containerIds = Array.from(
      { length: 1_001 },
      (_, index) => `bulk-folder-${index}`,
    );
    const { db } = getClientSQLitePersistenceRuntime(execSql);
    for (const batch of remoteResetBatches(containerIds)) {
      await db.insert(containers).values(
        batch.map((id) => ({
          id,
          localCreatedAt: UPDATED_AT,
          localUpdatedAt: UPDATED_AT,
          metadataDocumentId: `metadata-${id}`,
          organizationId: "org-paused",
          parentId: null,
          serverCreatedAt: UPDATED_AT,
          serverUpdatedAt: UPDATED_AT,
        })),
      );
      await db.insert(documents).values(
        batch.map((id) => ({
          appKind: "container-metadata",
          documentId: `metadata-${id}`,
          localId: id,
          snapshotEndVersion: "",
          updatedAt: UPDATED_AT,
        })),
      );
    }
    const boundedExecSql = bindBudgetedExecSql(execSql);

    const removal = await removeOrganizationContentUnlessPending({
      containerIds,
      deleteContainers: (lockedExecSql, removals) =>
        sqlContainerContentsPersistence.deleteContainers(
          lockedExecSql,
          removals,
        ),
      documentProjectors: createDocumentProjectorRegistry([]),
      execSql: boundedExecSql,
      isDocumentOpen: () => false,
      organizationId: "org-paused",
    });

    expect(removal.status).toBe("removed");
    expect(removal.deletedContainerIds).toHaveLength(containerIds.length);
    expect(boundedExecSql.maxBinds()).toBeLessThanOrEqual(999);
    expect(await db.select().from(containers)).toEqual([]);
  } finally {
    close();
  }
});
