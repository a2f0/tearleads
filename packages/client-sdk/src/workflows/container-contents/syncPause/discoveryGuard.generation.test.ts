import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { resetAccessDiscovery } from "../../../data/persistence/container-contents/containerAccessDiscovery";
import {
  containerContentsSyncLane,
  sqlContainerSyncWatermarkPersistence as watermarks,
} from "../../../data/persistence/container-contents/containerSyncWatermarkPersistence";
import { createDocumentDiscoveryEvidenceStore } from "../../../data/persistence/documents/documentDiscoveryEvidencePersistence";
import { runSerializedSqlMutation } from "../../../data/sqlite/sqlExec";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  laneLister,
  nullContainerDocumentWatermarks,
} from "../documentDiscovery/documentDiscovery.testUtils";
import type { DiscoverContainerDocumentsOptions } from "../documentDiscovery/documentDiscoveryTypes";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "../documentDiscovery/index";
import { guardDiscoveryAgainstPause } from "./discoveryGuard";

test.each(["single", "all"] as const)(
  "%s discovery cannot restore a cursor after a permission change",
  async (scope) => {
    const { execSql, close } = await createTestExecSql("discovery-access-race");
    try {
      await watermarks.ensureSchema(execSql);
      const evidence = createDocumentDiscoveryEvidenceStore(execSql);
      const cursor = { id: "document", updatedAt: "2026-01-01T00:00:00.000Z" };
      const container = {
        id: "shared",
        name: "Shared",
        parentId: null,
        organizationId: "organization",
        metadataDocumentId: "metadata",
        icon: null,
        effectiveAccessLevel: "read" as const,
      };
      const guarded = guardDiscoveryAgainstPause({
        execSql,
        isPaused: () => false,
        verifyDiscoveredDocuments: async (_inputs, _ids, generation) => ({
          inputs: [],
          commit: async () => true,
          isCurrent: () => evidence.isCurrent(generation),
        }),
      });
      let reset = true;
      const options: DiscoverContainerDocumentsOptions = {
        ...nullContainerDocumentWatermarks,
        ...guarded,
        beginDocumentDiscovery: () => evidence.begin(),
        containerId: container.id,
        listContainerDocumentLanes: laneLister(async () => ({
          hasMore: false,
          items: [],
          nextWatermark: cursor,
          tombstones: [],
        })),
        saveContainerDocumentWatermark: async (...args) => {
          if (!reset) return guarded.saveContainerDocumentWatermark(...args);
          reset = false;
          // Apply has already checked the generation. The permission change
          // holds the write lock while this old listing queues its cursor.
          let release = () => {};
          const held = new Promise<void>((resolve) => {
            release = resolve;
          });
          const cleanup = runSerializedSqlMutation(execSql, async (locked) => {
            await held;
            await getClientSQLitePersistenceRuntime(locked).db.transaction(
              (tx) =>
                resetAccessDiscovery(tx, container, {
                  ...container,
                  effectiveAccessLevel: "write",
                }),
            );
          });
          const save = guarded.saveContainerDocumentWatermark(...args);
          release();
          await cleanup;
          await save;
        },
      };
      const discover = () =>
        scope === "single"
          ? discoverContainerDocuments(options)
          : discoverAllContainerDocuments({
              ...options,
              containerIds: [container.id],
            });
      const staleResult = await discover();
      expect(reset).toBe(false);
      expect(
        await watermarks.loadWatermark(
          execSql,
          containerContentsSyncLane(container.id),
        ),
      ).toBeNull();
      expect(staleResult).toBeNull();
      // A subsequent listing may advance normally; the guard must not freeze
      // discovery after it discards the stale write.
      await discover();
      expect(
        await watermarks.loadWatermark(
          execSql,
          containerContentsSyncLane(container.id),
        ),
      ).toEqual(cursor);
    } finally {
      close();
    }
  },
);
