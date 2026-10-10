import { expect, test } from "bun:test";
import { withTestExecSql } from "../../../../test/helpers/withTestExecSql";
import { createContainerMetadataDocument } from "../../../data/containers/containerMetadataDocument";
import { sqlContainerContentsPersistence as persistence } from "../../../data/persistence/container-contents/containerContentsPersistence";
import { sqlDocumentsPersistence } from "../../../data/persistence/documents/documentsPersistence";
import type { ContainerState } from "../remoteHydration";
import type { ContainerContentsWorkflowRuntime } from "../runtime";
import { purgeContainerTree } from "./purgeTree";

for (const restored of [false, true]) {
  test(`remote root deletion preserves a settled restore (${restored})`, async () => {
    await withTestExecSql("purge-settled-root", async (execSql) => {
      await persistence.ensureSchema(execSql);
      await sqlDocumentsPersistence.ensureSchema(execSql);
      const state: ContainerState = {
        container: {
          id: "root",
          parentId: "trash",
          organizationId: "org",
          name: "Selected",
          icon: null,
          metadataDocumentId: "metadata",
        },
        record: {
          id: "root",
          documentId: "metadata",
          accessEpoch: 1,
          snapshotEndVersion: "",
          metadataUpdates: "",
        },
        doc: await createContainerMetadataDocument("root"),
      };
      await persistence.saveContainer(execSql, state.container, state.record);
      const containersById = new Map([["root", state]]);
      let deletes = 0;
      await purgeContainerTree({
        containersById,
        rootContainerId: "root",
        resolveProjectionUserKey: async () => null,
        prepareDocumentRotationSnapshot: async () => null,
        persistence: {
          ...persistence,
          listUnsyncedMoveIntents: async (connection) => {
            if (restored) {
              const container = { ...state.container, parentId: "restored" };
              await persistence.saveContainer(
                connection,
                container,
                state.record,
              );
              containersById.set("root", { ...state, container });
            }
            return persistence.listUnsyncedMoveIntents(connection);
          },
        },
        runtime: {
          infra: { execSql },
          util: { log: () => {} },
          apiClient: {
            deleteContainerResult: async () => {
              deletes += 1;
              return { ok: false, status: 409, report: () => {} };
            },
          },
        } as unknown as ContainerContentsWorkflowRuntime,
      });
      expect(deletes).toBe(restored ? 0 : 1);
      expect(await persistence.listUnsyncedMoveIntents(execSql)).toEqual([]);
    });
  });
}
