import { expect, test } from "bun:test";
import { exportAllUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ExplorerPersistence } from "../../data/persistence/explorer/explorerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { enqueuePendingExplorerContainerUpdateFromRuntime } from "./containerPersistence";
import { createExplorerWorkflowSqlRuntime } from "./runtime";

const execSql: ExecSql = async () => [];

type PendingUpdateInput = Parameters<
  ExplorerPersistence["enqueuePendingUpdate"]
>[1];

function createExplorerPersistence(input: {
  pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
}): ExplorerPersistence {
  return {
    async deleteContainer() {},
    async deleteContainers() {},
    async deletePendingUpdates() {},
    async ensureSchema() {},
    async enqueuePendingUpdate(receivedExecSql, pendingUpdate) {
      input.pendingUpdates.push({
        execSql: receivedExecSql,
        input: pendingUpdate,
      });
    },
    async listPendingCreateIntents() {
      return [];
    },
    async listPendingUpdates() {
      return [];
    },
    async loadContainers() {
      return [];
    },
    async markCreateIntentSynced() {},
    async recordCreateIntentError() {},
    async reassignContainerDocuments() {},
    async reconcileLocalRootContainer() {},
    async saveContainer(_execSql, container) {
      return container;
    },
    async saveContainerAndDeletePendingUpdates(_execSql, container) {
      return container;
    },
  };
}

test("enqueuePendingExplorerContainerUpdateFromRuntime uses the runtime executor", async () => {
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];
  const doc = await createContainerMetadataDocument("container-1");
  writeContainerMetadataValue(doc, {
    icon: null,
    name: "Container 1",
  });

  await enqueuePendingExplorerContainerUpdateFromRuntime({
    containerId: "container-1",
    persistence: createExplorerPersistence({ pendingUpdates }),
    runtime: createExplorerWorkflowSqlRuntime({ execSql }),
    sourceVersionVector: "version-1",
    update: exportAllUpdates(doc),
  });

  expect(pendingUpdates).toHaveLength(1);
  expect(pendingUpdates[0]?.execSql).toBe(execSql);
  expect(pendingUpdates[0]?.input).toMatchObject({
    containerId: "container-1",
    sourceVersionVector: "version-1",
  });
});
