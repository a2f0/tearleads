import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../../test/helpers/data/withTestExecSql";
import { DocumentContainerProjectionRepository as Links } from "../../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { DocumentMoveIntentRepository } from "../../../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentsPersistence } from "../../../../data/persistence/documents/documentsPersistence";
import { SQLITE_BOUND_VARIABLE_BUDGET } from "../../../../data/sqlite/sqliteBindBudget";
import { defaultContainerContentsPersistence } from "../../containerPersistence";
import type { ContainerState } from "../../remoteHydration";
import { settlePurgeScopeMoves } from "./purgeMoveSettlement";
import { purgeContainerTree } from "./purgeTree";

function containerState(id: string, parentId: string | null): ContainerState {
  return {
    container: { id, parentId },
    record: { documentId: null },
  } as unknown as ContainerState;
}

test("purgeContainerTree purges a sole in-subtree link whose primary containerId is stale outside", async () => {
  await withTestExecSql(
    "purge-tree-stale-primary-sole-link",
    async (execSql) => {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const documentId = "sole-link-stale-primary";
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "document-access-state",
          // Simulates a primary pointer left on Trash after Empty Trash unlinked
          // Trash without deleting the Trash bin itself.
          containerId: "stale-trash-primary",
          documentId,
          documentKind: "note",
          id: "local-stale-primary",
          snapshotEndVersion: "",
          text: "",
          title: "Stale primary sole link",
        },
        { updatedAt: "2026-09-01T00:00:00.000Z" },
      );
      await new Links(execSql).replaceDocumentLinks(documentId, ["trashed"]);

      const operations: string[] = [];
      const result = await purgeContainerTree({
        containersById: new Map([["trashed", containerState("trashed", null)]]),
        documentOperations: {
          purgeLocal: async () => {
            throw new Error("Unexpected local purge");
          },
          purgeRemote: async (document, retainedContainerId) => {
            operations.push(
              `purge:${document.documentId}:${retainedContainerId ?? "none"}`,
            );
            return true;
          },
          unlink: async () => {
            throw new Error("Unexpected unlink");
          },
        },
        persistence: {
          ...defaultContainerContentsPersistence,
          deleteContainers: async () => ["trashed"],
          listUnsyncedMoveIntents: async () => [],
          loadContainerMetadataState: async (_execSql, id) =>
            containerState(id, null),
        },
        prepareDocumentRotationSnapshot: async () => null,
        resolveProjectionUserKey: async () => null,
        rootContainerId: "trashed",
        runtime: { infra: { execSql } } as never,
      });

      expect(operations).toEqual([`purge:${documentId}:trashed`]);
      expect(result).toMatchObject({
        aborted: false,
        completedCount: 2,
        failedCount: 0,
        purgedContainerIds: ["trashed"],
        totalCount: 2,
      });
    },
  );
});

test("subtree purge planning and move settlement stay within SQLite bind limits past 999 linked documents", async () => {
  await withTestExecSql("purge-tree-bind-budget", async (execSql) => {
    await sqlDocumentsPersistence.ensureSchema(execSql);
    const links = new Links(execSql);
    await links.ensureSchema();

    const count = SQLITE_BOUND_VARIABLE_BUDGET + 50;
    const timestamp = "2026-09-01T00:00:00.000Z";
    const placementBatch: Array<{
      containerIds: readonly string[];
      documentId: string;
    }> = [];
    for (let index = 0; index < count; index += 1) {
      const localId = `local-${String(index).padStart(4, "0")}`;
      const documentId = `remote-${String(index).padStart(4, "0")}`;
      await execSql(
        `INSERT INTO documents (
           app_kind, local_id, document_id, access_epoch, snapshot_end_version, updated_at
         ) VALUES ('documents', ?, ?, 1, '', ?)`,
        [localId, documentId, timestamp],
      );
      await execSql(
        `INSERT INTO document_projection (
           local_id, document_id, container_id, document_kind, title, updated_at
         ) VALUES (?, ?, 'outside-primary', 'note', ?, ?)`,
        [localId, documentId, `Note ${index}`, timestamp],
      );
      placementBatch.push({
        documentId,
        containerIds: ["outside-primary", "trashed"],
      });
    }
    await links.replaceDocumentLinksBatch(placementBatch);

    // Queue a parked placement intent on the final linked document so
    // `settlePurgeScopeMoves` must scan past the 999-bind boundary.
    const lastDocumentId = `remote-${String(count - 1).padStart(4, "0")}`;
    const lastLocalId = `local-${String(count - 1).padStart(4, "0")}`;
    await new DocumentMoveIntentRepository(execSql).enqueueMoveIntent({
      documentId: lastDocumentId,
      localId: lastLocalId,
      sourceContainerId: "outside-primary",
      targetContainerId: "elsewhere",
    });
    await new DocumentMoveIntentRepository(execSql).recordMoveIntentError({
      denied: true,
      documentId: lastDocumentId,
      message: "denied",
    });

    const containersById = new Map([
      ["trashed", containerState("trashed", null)],
    ]);
    const settlement = await settlePurgeScopeMoves({
      containersById,
      execSql,
      lane: {
        read: () => ({
          lastStartedAt: null,
          requested: false,
          runCount: 0,
          running: false,
        }),
        request: () => {},
      },
      persistence: { listUnsyncedMoveIntents: async () => [] },
      report: () => {},
      rootContainerId: "trashed",
      stillCurrent: () => true,
      timing: { pollMs: 1, timeoutMs: 1_000 },
    });
    expect(settlement).toBe("unsettled");

    // Clear the parked intent and verify `purgeContainerTree` plans all >999
    // secondary-linked documents cleanly without hitting SQLITE_MAX_VARIABLE_NUMBER.
    await execSql("DELETE FROM local_intents WHERE local_id = ?", [
      lastLocalId,
    ]);
    let unlinkedCount = 0;
    const result = await purgeContainerTree({
      containersById,
      documentOperations: {
        purgeLocal: async () => {
          throw new Error("Unexpected local purge");
        },
        purgeRemote: async () => {
          throw new Error("Unexpected remote purge");
        },
        unlink: async () => {
          unlinkedCount += 1;
          return true;
        },
      },
      persistence: {
        ...defaultContainerContentsPersistence,
        deleteContainers: async () => ["trashed"],
        listUnsyncedMoveIntents: async () => [],
        loadContainerMetadataState: async (_execSql, id) =>
          containerState(id, null),
      },
      prepareDocumentRotationSnapshot: async () => null,
      resolveProjectionUserKey: async () => null,
      rootContainerId: "trashed",
      runtime: { infra: { execSql } } as never,
    });

    expect(unlinkedCount).toBe(count);
    expect(result).toMatchObject({
      aborted: false,
      completedCount: count + 1,
      failedCount: 0,
      purgedContainerIds: ["trashed"],
      totalCount: count + 1,
    });
  });
}, 30_000);

test("purgeContainerTree skips a stale primary inside the subtree whose remaining links are all external", async () => {
  await withTestExecSql(
    "purge-tree-stale-primary-external-only",
    async (execSql) => {
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const documentId = "stale-primary-external-only";
      await sqlDocumentsPersistence.saveDocument(
        execSql,
        {
          accessEpoch: 1,
          accessStateHash: "document-access-state",
          containerId: "trashed",
          documentId,
          documentKind: "note",
          id: "local-stale-external",
          snapshotEndVersion: "",
          text: "",
          title: "Already unlinked from trashed",
        },
        { updatedAt: "2026-09-01T00:00:00.000Z" },
      );
      await new Links(execSql).replaceDocumentLinks(documentId, ["outside"]);

      const result = await purgeContainerTree({
        containersById: new Map([["trashed", containerState("trashed", null)]]),
        documentOperations: {
          purgeLocal: async () => {
            throw new Error("Unexpected local purge");
          },
          purgeRemote: async () => {
            throw new Error("Unexpected remote purge");
          },
          unlink: async () => {
            throw new Error("Unexpected no-op unlink");
          },
        },
        persistence: {
          ...defaultContainerContentsPersistence,
          deleteContainers: async () => ["trashed"],
          listUnsyncedMoveIntents: async () => [],
          loadContainerMetadataState: async (_execSql, id) =>
            containerState(id, null),
        },
        prepareDocumentRotationSnapshot: async () => {
          throw new Error("Unexpected rotation snapshot preparation");
        },
        resolveProjectionUserKey: async () => null,
        rootContainerId: "trashed",
        runtime: { infra: { execSql } } as never,
      });

      expect(result).toMatchObject({
        aborted: false,
        completedCount: 1,
        failedCount: 0,
        purgedContainerIds: ["trashed"],
        totalCount: 1,
      });
    },
  );
});

test("listDocumentIdsByContainerIds chunks past 999 containers and deduplicates sorted ids", async () => {
  await withTestExecSql("purge-tree-many-containers", async (execSql) => {
    const links = new Links(execSql);
    await links.ensureSchema();
    const containerIds = Array.from(
      { length: SQLITE_BOUND_VARIABLE_BUDGET + 50 },
      (_, index) => `container-${String(index).padStart(4, "0")}`,
    );
    await links.replaceDocumentLinksBatch([
      {
        documentId: "doc-b",
        containerIds: [containerIds[0] ?? "", containerIds.at(-1) ?? ""],
      },
      {
        documentId: "doc-a",
        containerIds: [containerIds.at(-1) ?? ""],
      },
    ]);

    expect(await links.listDocumentIdsByContainerIds(containerIds)).toEqual([
      "doc-a",
      "doc-b",
    ]);
  });
});
