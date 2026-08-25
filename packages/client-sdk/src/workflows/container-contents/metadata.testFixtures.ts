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

const metadataTestPersistenceStubs = {
  async claimDormantMetadataSweepAttempt() {
    return false;
  },
  async completeDormantMetadataSweepRequest() {},
  async containerExists() {
    return false;
  },
  async deleteContainer() {},
  async deleteContainers() {
    return [];
  },
  async deletePendingUpdate() {},
  async deletePendingUpdates() {},
  async ensureSchema() {},
  async listContainerIdsWithPendingUpdates() {
    return [];
  },
  async listContainerIdsWithPullContinuations() {
    return [];
  },
  async listDormantMetadataSweepCandidates() {
    return [];
  },
  async listDormantMetadataSweepRequests() {
    return [];
  },
  async listPendingCreateIntents() {
    return [];
  },
  async listPendingUpdates() {
    return [];
  },
  async listUnsyncedMoveIntents() {
    return [];
  },
  async markCreateIntentSynced() {},
  async markMoveIntentSynced() {},
  async purgeDormantContainerMetadata() {},
  async purgeDormantContainerMetadataCandidates() {
    return 0;
  },
  async recordCreateIntentError() {},
  async recordMoveIntentError() {},
  async reassignContainerDocuments() {},
  async reconcileLocalRootContainer() {},
  async reconcileLocalSystemContainer() {},
  async rekeyPendingUpdate() {
    return null;
  },
} satisfies Partial<ContainerContentsPersistence>;

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
    ...metadataTestPersistenceStubs,
    async loadContainerHydrationTombstones() {
      return [];
    },
    async commitHydratedContainer(_execSql, { container }) {
      return { committed: true, container };
    },
    async commitMetadataMutation(
      receivedExecSql,
      { container, pendingUpdate, record, saveOptions },
    ) {
      if (pendingUpdate) {
        input.pendingUpdates?.push({
          execSql: receivedExecSql,
          input: { containerId: container.id, ...pendingUpdate },
        });
      }
      const call: SaveContainerCall = {
        container,
        execSql: receivedExecSql,
        record,
      };
      if (saveOptions) call.options = saveOptions;
      input.savedContainers?.push(call);
      return { committed: true, container };
    },
    async enqueuePendingUpdate(receivedExecSql, pendingUpdate) {
      input.pendingUpdates?.push({
        execSql: receivedExecSql,
        input: pendingUpdate,
      });
      return crypto.randomUUID();
    },
    async loadContainerMetadataRecord(_execSql, containerId) {
      return (
        input.storedContainers?.find(
          ({ container }) => container.id === containerId,
        )?.record ?? null
      );
    },
    async invalidateMetadataPullContinuation(_execSql, invalidation) {
      return (
        input.storedContainers?.find(
          ({ container }) => container.id === invalidation.containerId,
        )?.record ?? null
      );
    },
    async loadContainerMetadataState(_execSql, containerId) {
      return (
        input.storedContainers?.find(
          ({ container }) => container.id === containerId,
        ) ?? null
      );
    },
    async loadContainers() {
      return input.storedContainers ?? [];
    },
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
    async settleAcceptedMetadataPendingUpdates(_execSql, settlement) {
      return (
        input.storedContainers?.find(
          ({ container }) => container.id === settlement.containerId,
        ) ?? null
      );
    },
  };
}
