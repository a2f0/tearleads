import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createMemoryBlobStore } from "../../../data/blobs/memoryBlobStore";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { defaultDocumentProjectorRegistry } from "../../../data/documents/documentKinds";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence as documents } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";
import { createSubtreePurgeScope } from "./purgeTreeScope";

for (const restore of ["none", "queued", "blocked", "during-read"] as const) {
  test(`a root restore preserves its local subtree (${restore})`, async () => {
    await withTestExecSql("purge-root-restore", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await documents.ensureSchema(execSql);
      const root = {
        id: "selected",
        parentId: "trash",
        organizationId: "org",
        name: "Selected",
        icon: null,
        metadataDocumentId: "root-metadata",
        effectiveAccessLevel: "admin" as const,
      };
      const record = {
        id: root.id,
        documentId: null,
        accessEpoch: 1,
        metadataUpdates: "",
        snapshotEndVersion: "",
      };
      await persistence.saveContainer(execSql, root, record);
      await persistence.saveContainer(
        execSql,
        {
          ...root,
          id: "child",
          parentId: root.id,
          metadataDocumentId: "child-metadata",
        },
        { ...record, id: "child" },
      );
      const containersById = new Map<string, ContainerState>();
      for (const state of await persistence.loadContainers(execSql)) {
        if (!state.record) throw new Error("Missing local metadata record");
        containersById.set(state.container.id, {
          ...state,
          record: state.record,
          doc: await createContainerMetadataDocument(state.container.id),
        });
      }
      for (const id of ["selected", "child"])
        await documents.saveDocument(execSql, {
          id: `${id}-note`,
          containerId: id,
          documentId: null,
          accessEpoch: 1,
          documentKind: "note",
          title: id,
          text: "keep this work",
          snapshotEndVersion: "",
        });
      const queueRestore = async () => {
        await persistence.saveContainer(
          execSql,
          { ...root, parentId: "restored" },
          null,
          {
            moveIntent: {
              parentContainerId: "restored",
              previousParentContainerId: "trash",
            },
          },
        );
        if (restore === "blocked")
          await persistence.recordMoveIntentError(execSql, {
            blocked: true,
            containerId: root.id,
            message: "Destination not synced",
          });
      };
      if (restore === "queued" || restore === "blocked") await queueRestore();
      let queuedDuringRead = false;
      const input = {
        containersById,
        persistence: {
          ...persistence,
          loadContainerMetadataState: async (
            ...args: Parameters<typeof persistence.loadContainerMetadataState>
          ) => {
            const state = await persistence.loadContainerMetadataState(...args);
            if (restore === "during-read" && !queuedDuringRead) {
              queuedDuringRead = true;
              await queueRestore();
            }
            return state;
          },
        },
        rootContainerId: root.id,
        prepareDocumentRotationSnapshot: async () => null,
        resolveProjectionUserKey: async () => null,
        runtime: {
          infra: {
            execSql,
            blobStore: createMemoryBlobStore(),
            documentProjectors: defaultDocumentProjectorRegistry,
          },
          util: { log: () => {} },
        } as unknown as ContainerContentsWorkflowRuntime,
      };
      if (restore === "during-read")
        expect(
          await createSubtreePurgeScope(input).allowsContainer("child"),
        ).toBe(false);
      const result = await purgeContainerTree(input);
      for (const id of ["selected", "child"]) {
        expect(
          (await documents.loadDocument(execSql, `${id}-note`)) !== null,
        ).toBe(restore !== "none");
        expect(
          (await persistence.loadContainerMetadataState(execSql, id)) !== null,
        ).toBe(restore !== "none");
      }
      expect(result).toMatchObject({
        completedCount: restore === "none" ? 4 : 0,
        failedCount: restore === "none" ? 0 : 4,
      });
      expect(
        (await persistence.listUnsyncedMoveIntents(execSql)).map(
          (intent) => intent.containerId,
        ),
      ).toEqual(restore === "none" ? [] : [root.id]);
    });
  });
}
