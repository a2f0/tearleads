import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence as documents } from "../../../data/persistence/documents/documentsPersistence";
import { purgeLocalContainerDocument } from "../documentPurge";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";
import { createSubtreePurgeScope } from "./purgeTreeScope";

for (const race of [
  "none",
  "root-restore",
  "blocked-restore",
  "ancestor-move",
] as const) {
  test(`local deletion rolls back changed subtree scope (${race})`, async () => {
    await withTestExecSql("purge-scope-transaction", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await documents.ensureSchema(execSql);
      const containersById = new Map<string, ContainerState>();
      for (const [id, parentId] of [
        ["root", "trash"],
        ["child", "root"],
      ]) {
        if (!id || !parentId) throw new Error("Missing fixture container");
        const container = {
          id,
          parentId,
          organizationId: "org",
          name: id,
          icon: null,
          metadataDocumentId: `${id}-metadata`,
        };
        const record = {
          id,
          documentId: null,
          accessEpoch: 1,
          snapshotEndVersion: "",
          metadataUpdates: "",
        };
        await persistence.saveContainer(execSql, container, record);
        containersById.set(id, {
          container,
          record,
          doc: await createContainerMetadataDocument(id),
        });
      }
      await documents.saveDocument(execSql, {
        id: "note",
        documentId: null,
        containerId: "child",
        accessEpoch: 1,
        documentKind: "note",
        snapshotEndVersion: "",
        text: "Preserve this text",
        title: "Note",
      });
      const input = {
        containersById,
        persistence,
        rootContainerId: "root",
        resolveProjectionUserKey: async () => null,
        prepareDocumentRotationSnapshot: async () => null,
        runtime: {
          infra: {
            execSql,
            blobStore: createMemoryBlobStore(),
            documentProjectors: defaultDocumentProjectorRegistry,
          },
          util: { log: () => {} },
        } as unknown as ContainerContentsWorkflowRuntime,
      };
      const scope = createSubtreePurgeScope(input);
      const controller = new AbortController();
      let transactionChecks = 0;
      const result = await purgeContainerTree({
        ...input,
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.completedCount + progress.failedCount > 0)
            controller.abort();
        },
        documentOperations: {
          purgeLocal: async (document) =>
            (await purgeLocalContainerDocument({
              noteId: document.id,
              expectedContainerId: document.containerId,
              runtime: input.runtime,
              beforeDeleteInTransaction: async (txExecSql) => {
                transactionChecks += 1;
                // Teardown has run, so a scope refusal must roll it back.
                expect(
                  await documents.loadDocument(txExecSql, document.id),
                ).toBeNull();
                await scope.assertLocalScopeInTransaction(
                  txExecSql,
                  document.containerId,
                  document.id,
                );
              },
              persistence: {
                ...documents,
                deleteDocumentIfMatches: async (
                  lockedExecSql,
                  expected,
                  deleteProjection,
                ) => {
                  if (race !== "none") {
                    const id = race === "ancestor-move" ? "child" : "root";
                    const state = containersById.get(id);
                    if (!state) throw new Error("Missing restored container");
                    await persistence.saveContainer(
                      lockedExecSql,
                      { ...state.container, parentId: "outside" },
                      state.record,
                      race === "ancestor-move"
                        ? undefined
                        : {
                            moveIntent: {
                              parentContainerId: "outside",
                              previousParentContainerId:
                                state.container.parentId,
                            },
                          },
                    );
                    if (race === "blocked-restore")
                      await persistence.recordMoveIntentError(lockedExecSql, {
                        blocked: true,
                        containerId: id,
                        message: "Destination not synced",
                      });
                  }
                  return documents.deleteDocumentIfMatches(
                    lockedExecSql,
                    expected,
                    deleteProjection,
                  );
                },
              },
            })) !== null,
          purgeRemote: async () => {
            throw new Error("Unexpected remote document");
          },
          unlink: async () => {
            throw new Error("Unexpected unlink");
          },
        },
      });
      expect(transactionChecks).toBe(1);
      expect(result?.completedCount).toBe(race === "none" ? 1 : 0);
      const retained = await documents.loadDocument(execSql, "note");
      expect(retained?.text ?? null).toBe(
        race === "none" ? null : "Preserve this text",
      );
      if (race.includes("restore"))
        expect(await persistence.listUnsyncedMoveIntents(execSql)).toHaveLength(
          1,
        );
    });
  });
}
