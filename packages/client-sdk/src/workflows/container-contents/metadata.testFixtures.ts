import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord as ContainerDocumentRecord,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export const metadataTestExecSql: ExecSql = async () => [];

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];

export function createContainerRecord(
  input: Partial<ContainerRecord> & Pick<ContainerRecord, "id" | "parentId">,
): ContainerRecord {
  return {
    effectiveAccessLevel: "admin",
    icon: null,
    metadataDocumentId: null,
    name: "Stored container",
    organizationId: "org-1",
    ...input,
  };
}

export function createDocumentRecord(
  input: Partial<ContainerDocumentRecord> & Pick<ContainerDocumentRecord, "id">,
): ContainerDocumentRecord {
  return {
    accessEpoch: 1,
    accessStateHash: null,
    contentKeyBundle: null,
    documentId: null,
    documentKekTargets: null,
    documentManifestBundle: null,
    lastCommitLsn: null,
    metadataUpdates: "",
    snapshotEndVersion: "",
    ...input,
  };
}

export function createContainerContentsPersistence(input: {
  pendingUpdates?: Array<{
    execSql: ExecSql;
    input: PendingUpdateInput;
  }>;
  savedContainers?: Array<{
    container: ContainerRecord;
    execSql: ExecSql;
    record: ContainerDocumentRecord | null;
  }>;
}): ContainerContentsPersistence {
  return {
    async containerExists() {
      return false;
    },
    async deleteContainer() {},
    async deleteContainers() {},
    async deletePendingUpdates() {},
    async ensureSchema() {},
    async enqueuePendingUpdate(receivedExecSql, pendingUpdate) {
      input.pendingUpdates?.push({
        execSql: receivedExecSql,
        input: pendingUpdate,
      });
    },
    async listPendingCreateIntents() {
      return [];
    },
    async listPendingMoveIntents() {
      return [];
    },
    async listUnsyncedMoveIntents() {
      return [];
    },
    async listContainerIdsWithPendingUpdates() {
      return [];
    },
    async rekeyPendingUpdate() {
      return null;
    },
    async listPendingUpdates() {
      return [];
    },
    async loadContainers() {
      return [];
    },
    async markCreateIntentSynced() {},
    async markMoveIntentSynced() {},
    async recordCreateIntentError() {},
    async recordMoveIntentError() {},
    async reassignContainerDocuments() {},
    async reconcileLocalRootContainer() {},
    async reconcileLocalSystemContainer() {},
    async saveContainer(receivedExecSql, container, record) {
      input.savedContainers?.push({
        container,
        execSql: receivedExecSql,
        record,
      });
      return container;
    },
    async saveContainerAndDeletePendingUpdates(_execSql, container) {
      return container;
    },
  };
}
