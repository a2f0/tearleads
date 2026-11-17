import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { DocumentContainerProjectionRepository as Links } from "../../../data/persistence/container-contents/documentContainerProjectionPersistence";
import { DocumentMoveIntentRepository } from "../../../data/persistence/container-contents/documentMoveIntentPersistence";
import {
  applyContainerDocumentTombstones,
  sqlDocumentsPersistence as documents,
  upsertDiscoveredDocuments,
} from "../../../data/persistence/documents/documentsPersistence";
import { getClientSQLitePersistenceRuntime } from "../../../data/sqlite/sqlitePersistenceRuntime";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "../../../data/sqlite/sqlSchema";
import {
  discoverContainerDocuments,
  laneLister,
  nullContainerDocumentWatermarks,
} from "../documentDiscovery/documentDiscovery.testUtils";
import type { DiscoverContainerDocumentsOptions } from "../documentDiscovery/documentDiscoveryTypes";
import { listContainerContentsDocumentsForContainers } from "../documentQueries/documentSubtreeQueries";
import { settleDocumentMoveIntent } from "./documentMoveIntentSettlement";

const intents = (execSql: ExecSql) => new DocumentMoveIntentRepository(execSql);

test("a delayed trash tombstone preserves the latest trash intent after restore", async () => {
  const { execSql, close } = await createTestExecSql("move-tombstone-intent");
  try {
    await documents.ensureSchema(execSql);
    for (const id of ["moving", "unrelated"]) {
      await documents.saveDocument(execSql, {
        id,
        documentId: id,
        containerId: "trash",
        accessEpoch: 1,
        snapshotEndVersion: "",
        text: "",
      });
      await new Links(execSql).replaceDocumentLinks(id, ["trash"]);
    }
    for (const [revision, targetContainerId] of [
      "trash",
      "root",
      "trash",
    ].entries()) {
      const id = `intent-${revision}`;
      await intents(execSql).enqueueMoveIntent({
        id,
        documentId: "moving",
        localId: "moving",
        sourceContainerId: "root",
        targetContainerId,
        replaceLinkedContainers: true,
      });
      await documents.relinkPersistedDocument(execSql, {
        localId: "moving",
        documentId: "moving",
        containerId: targetContainerId,
        accessEpoch: 1,
      });
      await new Links(execSql).replaceDocumentLinks(
        "moving",
        [targetContainerId],
        {
          moveIntentId: id,
        },
      );
    }
    await applyContainerDocumentTombstones(
      execSql,
      ["moving", "unrelated"].map((documentId) => ({
        documentId,
        containerId: "trash",
        accessEpoch: 1,
        linkedContainerIds: [],
        updatedAt: "2026-09-17T00:00:00.000Z",
      })),
    );
    expect(await documents.loadDocument(execSql, "moving")).toMatchObject({
      containerId: "trash",
    });
    expect(await new Links(execSql).listLinkedContainerIds("moving")).toEqual([
      "trash",
    ]);
    expect(await intents(execSql).listPendingMoveIntents()).toMatchObject([
      { id: "intent-2", targetContainerId: "trash" },
    ]);
    expect(await documents.loadDocument(execSql, "unrelated")).toMatchObject({
      containerId: null,
    });
    expect(
      await new Links(execSql).listLinkedContainerIds("unrelated"),
    ).toEqual([]);
  } finally {
    close();
  }
});

test.each([
  ["root", "trash"],
  ["trash", "root"],
])(
  "discovery keeps the newest link set when %s is listed before %s",
  async (first, second) => {
    const { execSql, close } = await createTestExecSql("mixed-move-discovery");
    try {
      await documents.ensureSchema(execSql);
      await documents.saveDocument(execSql, {
        id: "local",
        documentId: "remote",
        containerId: "trash",
        accessEpoch: 3,
        accessStateHash: "trash-hash",
        snapshotEndVersion: "",
        text: "",
      });
      await new Links(execSql).replaceDocumentLinks("remote", ["trash"]);
      const options: Omit<DiscoverContainerDocumentsOptions, "containerId"> = {
        ...nullContainerDocumentWatermarks,
        listContainerDocumentLanes: laneLister(async (containerId) => ({
          hasMore: false,
          nextWatermark: null,
          tombstones: [],
          items: [
            {
              id: "remote",
              createdAt: "2026-09-17T00:00:00.000Z",
              updatedAt: "2026-09-17T00:00:00.000Z",
              currentAccessEpoch: containerId === "root" ? 1 : 3,
              currentAccessStateHash: `${containerId}-hash`,
              linkedContainerIds: [containerId],
              referencedPrincipals: [],
            },
          ],
        })),
        replaceDocumentLinksBatch: (inputs) =>
          new Links(execSql).replaceDocumentLinksBatch(inputs),
        upsertDiscoveredDocuments: (inputs) =>
          upsertDiscoveredDocuments(execSql, inputs),
      };
      for (const containerId of [first, second]) {
        await discoverContainerDocuments({ ...options, containerId });
      }
      expect(await new Links(execSql).listLinkedContainerIds("remote")).toEqual(
        ["trash"],
      );
    } finally {
      close();
    }
  },
);

test("discovery cannot return sequentially trashed documents to root", async () => {
  const { execSql, close } = await createTestExecSql("move-discovery-single");
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
      await new Links(execSql).replaceDocumentLinks(id, ["root"]);
    }
    const options: DiscoverContainerDocumentsOptions = {
      ...nullContainerDocumentWatermarks,
      containerId: "root",
      listContainerDocumentLanes: laneLister(async () => ({
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
      })),
      replaceDocumentLinksBatch: (inputs) =>
        new Links(execSql).replaceDocumentLinksBatch(inputs),
      upsertDiscoveredDocuments: (inputs) =>
        upsertDiscoveredDocuments(execSql, inputs),
    };
    const discover = () => discoverContainerDocuments(options);
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
      await new Links(execSql).replaceDocumentLinks(id, ["trash"]);
      await intents(execSql).enqueueMoveIntent({
        documentId: id,
        localId: id,
        sourceContainerId: "root",
        targetContainerId: "trash",
        replaceLinkedContainers: true,
      });
      await discover();
      await new Links(execSql).replaceDocumentLinks(id, ["root", "trash"]);
      expect(await rootIds()).toEqual(ids.slice(index + 1).sort());
      expect(await documents.loadDocument(execSql, id)).toMatchObject({
        containerId: "trash",
      });

      // Final placement and intent removal commit together. A listing
      // captured before this commit must stay obsolete after settlement.
      const intent = (await intents(execSql).listPendingMoveIntents()).find(
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
      await intents(execSql).enqueueMoveIntent({
        documentId: "remote",
        localId: "local",
        targetContainerId: "trash",
      });
      const [old] = await intents(execSql).listPendingMoveIntents();
      if (!old) throw new Error("Missing move");
      await intents(execSql).enqueueMoveIntent({
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
      expect(await intents(execSql).listPendingMoveIntents()).toHaveLength(1);
    } finally {
      close();
    }
  },
);
