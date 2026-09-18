import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlDocumentMoveIntentPersistence as intents } from "../../data/persistence/container-contents/documentMoveIntentPersistence";
import { sqlDocumentContainerProjectionPersistence as links } from "../../data/persistence/containers/documentContainerProjectionPersistence";
import {
  sqlDocumentsPersistence as documents,
  upsertDiscoveredDocuments,
} from "../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../data/sqlite/sqlitePersistenceRuntime";
import { runSerializedSqlMutation } from "../../data/sqlite/sqlSchema";
import {
  discoverAllContainerDocuments,
  discoverContainerDocuments,
} from "./documentDiscovery";
import { nullContainerDocumentWatermarks } from "./documentDiscovery.testUtils";
import type { DiscoverContainerDocumentsOptions } from "./documentDiscoveryTypes";
import { settleDocumentMoveIntent } from "./documentMoveIntentSettlement";
import { listContainerContentsDocumentsForContainers } from "./documentSubtreeQueries";

for (const mode of ["single", "all"]) {
  test(`${mode} discovery cannot return sequentially trashed documents to root`, async () => {
    const { execSql, close } = await createTestExecSql(
      `move-discovery-${mode}`,
    );
    try {
      await documents.ensureSchema(execSql);
      const ids = ["one", "two", "three"];
      for (const id of ids) {
        await documents.saveDocument(execSql, {
          id,
          documentId: id,
          containerId: "root",
          accessEpoch: 1,
          accessStateHash: "root-hash",
          snapshotEndVersion: "",
          text: id,
        });
        await links.replaceDocumentLinks(execSql, id, ["root"]);
      }
      const options: DiscoverContainerDocumentsOptions = {
        ...nullContainerDocumentWatermarks,
        containerId: "root",
        listContainerDocuments: async () => ({
          hasMore: false,
          nextWatermark: null,
          tombstones: [],
          items: ids.map((id) => ({
            id,
            createdAt: "2026-09-17T00:00:00.000Z",
            updatedAt: "2026-09-17T00:00:00.000Z",
            currentAccessEpoch: 1,
            currentAccessStateHash: "root-hash",
            linkedContainerIds: ["root"],
            referencedPrincipals: [],
          })),
        }),
        replaceDocumentLinksBatch: (inputs) =>
          links.replaceDocumentLinksBatch(execSql, inputs),
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredDocuments(execSql, inputs),
      };
      const discover = () =>
        mode === "single"
          ? discoverContainerDocuments(options)
          : discoverAllContainerDocuments({
              ...options,
              containerIds: ["root"],
            });
      const rootIds = async () =>
        (
          await listContainerContentsDocumentsForContainers(execSql, ["root"], {
            sortDocumentSummaries: false,
          })
        ).documentSummaries
          .map((row) => row.id)
          .sort();

      for (const [index, id] of ids.entries()) {
        // Simulate the atomic local move, then delayed discovery and the
        // intermediate remote link result while other root rows remain live.
        await documents.relinkPersistedDocument(execSql, {
          localId: id,
          documentId: id,
          containerId: "trash",
          accessEpoch: 1,
        });
        await links.replaceDocumentLinks(execSql, id, ["trash"]);
        await intents.enqueueMoveIntent(execSql, {
          documentId: id,
          localId: id,
          sourceContainerId: "root",
          targetContainerId: "trash",
          replaceLinkedContainers: true,
        });
        await discover();
        await links.replaceDocumentLinks(execSql, id, ["root", "trash"]);
        expect(await rootIds()).toEqual(ids.slice(index + 1).sort());
        expect(await documents.loadDocument(execSql, id)).toMatchObject({
          containerId: "trash",
        });

        // Final placement and intent removal commit together. A listing
        // captured before this commit must stay obsolete after settlement.
        const intent = (await intents.listPendingMoveIntents(execSql)).find(
          (row) => row.documentId === id,
        );
        if (!intent) throw new Error("Missing move intent");
        await runSerializedSqlMutation(execSql, (execSql) =>
          getClientSQLitePersistenceRuntime(execSql).transaction(async () => {
            await documents.relinkPersistedDocument(execSql, {
              localId: id,
              documentId: id,
              containerId: "trash",
              accessEpoch: 3,
              accessStateHash: "trash-hash",
            });
            await settleDocumentMoveIntent({
              execSql,
              intent,
              isCurrent: () => true,
              linkedContainerIds: ["trash"],
              partial: false,
            });
          }),
        );
        await discover();
        expect(await rootIds()).toEqual(ids.slice(index + 1).sort());
        expect(await documents.loadDocument(execSql, id)).toMatchObject({
          containerId: "trash",
          accessEpoch: 3,
          accessStateHash: "trash-hash",
        });
      }
    } finally {
      close();
    }
  });
}

test.each([false, true])(
  "a superseded replay cannot commit placement (partial: %s)",
  async (partial) => {
    const { execSql, close } = await createTestExecSql(
      `superseded-move-placement-${partial}`,
    );
    try {
      await documents.ensureSchema(execSql);
      await documents.saveDocument(execSql, {
        id: "local",
        documentId: "remote",
        containerId: "trash",
        accessEpoch: 1,
        snapshotEndVersion: "",
        text: "",
      });
      await intents.enqueueMoveIntent(execSql, {
        documentId: "remote",
        localId: "local",
        targetContainerId: "trash",
      });
      const [old] = await intents.listPendingMoveIntents(execSql);
      if (!old) throw new Error("Missing move");
      await intents.enqueueMoveIntent(execSql, {
        documentId: "remote",
        localId: "local",
        targetContainerId: "restored",
      });
      await documents.relinkPersistedDocument(execSql, {
        localId: "local",
        documentId: "remote",
        containerId: "restored",
        accessEpoch: 1,
      });
      await expect(
        runSerializedSqlMutation(execSql, (execSql) =>
          getClientSQLitePersistenceRuntime(execSql).transaction(async () => {
            await documents.relinkPersistedDocument(execSql, {
              localId: "local",
              documentId: "remote",
              containerId: "trash",
              accessEpoch: 2,
            });
            await settleDocumentMoveIntent({
              execSql,
              intent: old,
              isCurrent: () => true,
              linkedContainerIds: ["trash"],
              partial,
            });
          }),
        ),
      ).rejects.toThrow("superseded");
      expect(await documents.loadDocument(execSql, "local")).toMatchObject({
        containerId: "restored",
        accessEpoch: 1,
      });
      expect(await intents.listPendingMoveIntents(execSql)).toHaveLength(1);
    } finally {
      close();
    }
  },
);
