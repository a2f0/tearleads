import type {
  ContainerContentsPersistence,
  ContainerMetadataRecord as ContainerDocumentRecord,
  StoredContainerState,
} from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export const metadataTestExecSql: ExecSql = async () => [];

type PendingUpdateInput = Parameters<
  ContainerContentsPersistence["enqueuePendingUpdate"]
>[1];
type SaveContainerOptions = Parameters<
  ContainerContentsPersistence["saveContainer"]
>[3];

export interface SaveContainerCall {
  container: ContainerRecord;
  execSql: ExecSql;
  options?: SaveContainerOptions;
  record: ContainerDocumentRecord | null;
}

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
  savedContainers?: SaveContainerCall[];
  storedContainers?: ReadonlyArray<StoredContainerState>;
}): ContainerContentsPersistence {
  return {
    async claimDormantMetadataSweepAttempt() {
      return false;
    },
    async completeDormantMetadataSweepRequest() {},
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
    async listUnsyncedMoveIntents() {
      return [];
    },
    async listContainerIdsWithPendingUpdates() {
      return [];
    },
    async loadContainerMetadataRecord() {
      return null;
    },
    async purgeDormantContainerMetadata() {},
    async listDormantMetadataSweepCandidates() {
      return [];
    },
    async purgeDormantContainerMetadataCandidates() {
      return 0;
    },
    async rekeyPendingUpdate() {
      return null;
    },
    async listPendingUpdates() {
      return [];
    },
    async listDormantMetadataSweepRequests() {
      return [];
    },
    async loadContainers() {
      return input.storedContainers ?? [];
    },
    async markCreateIntentSynced() {},
    async markMoveIntentSynced() {},
    async recordCreateIntentError() {},
    async recordMoveIntentError() {},
    async reassignContainerDocuments() {},
    async reconcileLocalRootContainer() {},
    async reconcileLocalSystemContainer() {},
    async saveContainer(receivedExecSql, container, record, options) {
      const call: SaveContainerCall = {
        container,
        execSql: receivedExecSql,
        record,
      };
      if (options) {
        call.options = options;
      }
      input.savedContainers?.push(call);
      return container;
    },
    async saveContainerAndDeletePendingUpdates(_execSql, container) {
      return container;
    },
  };
}
