import { expect, test } from "bun:test";
import { exportAllUpdates } from "@tearleads/loro";
import {
  createContainerMetadataDocument,
  writeContainerMetadataValue,
} from "../../data/containers/containerMetadataDocument";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { enqueuePendingContainerUpdateFromRuntime } from "./containerPersistence";
import { createContainerContentsWorkflowSqlRuntime } from "./runtime";

const execSql: ExecSql = async () => [];

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];

function createContainerContentsPersistence(input: {
  pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
}): ContainerContentsPersistence {
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

test("enqueuePendingContainerUpdateFromRuntime uses the runtime executor", async () => {
  const pendingUpdates: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }> = [];
  const doc = await createContainerMetadataDocument("container-1");
  writeContainerMetadataValue(doc, {
    icon: null,
    name: "Container 1",
  });

  await enqueuePendingContainerUpdateFromRuntime({
    containerId: "container-1",
    persistence: createContainerContentsPersistence({ pendingUpdates }),
    runtime: createContainerContentsWorkflowSqlRuntime({ execSql }),
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
