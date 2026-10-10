import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";

for (const race of [
  "none",
  "root-restore",
  "ancestor-move",
  "live-root-move",
] as const) {
  test(`local container teardown checks its ancestry at commit (${race})`, async () => {
    await withTestExecSql("purge-container-commit", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const containersById = new Map<string, ContainerState>();
      for (const [id, parentId] of [
        ["root", "trash"],
        ["middle", "root"],
        ["leaf", "middle"],
      ] as const) {
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
      const controller = new AbortController();
      let deletionAttempts = 0;
      const result = await purgeContainerTree({
        containersById,
        rootContainerId: "root",
        signal: controller.signal,
        onProgress: (progress) => {
          if (progress.completedCount + progress.failedCount > 0)
            controller.abort();
        },
        resolveProjectionUserKey: async () => null,
        prepareDocumentRotationSnapshot: async () => null,
        runtime: {
          infra: { execSql },
          util: { log: () => {} },
        } as unknown as ContainerContentsWorkflowRuntime,
        persistence: {
          ...persistence,
          deleteContainers: async (connection, removals, options) => {
            deletionAttempts += 1;
            expect(removals.map((removal) => removal.containerId)).toEqual([
              "leaf",
            ]);
            if (race !== "none") {
              const id = race === "ancestor-move" ? "middle" : "root";
              const state = containersById.get(id);
              if (!state) throw new Error("Missing moved ancestor");
              const container = { ...state.container, parentId: "outside" };
              await persistence.saveContainer(
                connection,
                container,
                state.record,
                race === "root-restore"
                  ? {
                      moveIntent: {
                        parentContainerId: "outside",
                        previousParentContainerId: state.container.parentId,
                      },
                    }
                  : undefined,
              );
              if (race === "live-root-move") {
                // Exercise both replacing the map entry and mutating a held object.
                state.container.parentId = "outside";
                containersById.set(id, { ...state, container });
              }
            }
            return persistence.deleteContainers(connection, removals, options);
          },
        },
      });
      expect(deletionAttempts).toBe(1);
      expect(result?.completedCount).toBe(race === "none" ? 1 : 0);
      expect(
        (await persistence.loadContainerMetadataState(execSql, "leaf")) !==
          null,
      ).toBe(race !== "none");
      if (race === "root-restore")
        expect(await persistence.listUnsyncedMoveIntents(execSql)).toHaveLength(
          1,
        );
    });
  });
}
