import type { DocumentSyncPullContinuation } from "../../documents/shared/pullContinuation";
import type {
  DocumentRecord,
  PendingUpdateFields,
  PendingUpdateRecord,
} from "../../sqlite/documentPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";
import type { ContainerRecord } from "../containers/containerPersistence";
import type { DormantMetadataSweepPersistence } from "./dormantMetadataSweep";

export const CONTAINER_CREATE_INTENT_TYPE = "container.create";
export const CONTAINER_MOVE_INTENT_TYPE = "container.move";

export type ContainerCreateIntentSyncStatus = "pending" | "synced";
export type ContainerMoveIntentSyncStatus = "pending" | "blocked";

export interface ContainerCreateIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  intentType: typeof CONTAINER_CREATE_INTENT_TYPE;
  syncStatus: ContainerCreateIntentSyncStatus;
  remoteContainerId: string | null;
  remoteMetadataDocumentId: string | null;
  remoteMetadataAccessStateHash: string | null;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerMoveIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  previousParentContainerId: string | null;
  intentType: typeof CONTAINER_MOVE_INTENT_TYPE;
  syncStatus: ContainerMoveIntentSyncStatus;
  lastError: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContainerCreateIntentInput {
  id?: string;
  parentContainerId: string;
}

export interface ContainerMoveIntentInput {
  id?: string;
  parentContainerId: string;
  previousParentContainerId?: string | null | undefined;
}

export interface LocalRootDescendantReparentInput {
  containerId: string;
  parentContainerId: string | null;
  updateCreateIntent?: boolean | undefined;
}

/**
 * A container's metadata document record plus its durable content: the full
 * Loro updates export of the metadata document, stored in the shared
 * history-checkpoint table under the container-metadata app kind. Metadata
 * documents are tiny registries, so the whole update log is the checkpoint.
 */
export interface ContainerMetadataRecord extends DocumentRecord {
  metadataUpdates: string;
}

export interface StoredContainerState {
  container: ContainerRecord;
  record: ContainerMetadataRecord | null;
}

export interface ContainerRemoval {
  containerId: string;
  reason: "access_revoked" | "deleted";
  updatedAt: string;
}

export interface ContainerHydrationTombstone extends ContainerRemoval {
  generation: number;
}

export interface ContainerDeletionGuard {
  containerId: string;
  expectedContainer: ContainerRecord | null;
}

export interface SaveContainerOptions {
  createIntent?: ContainerCreateIntentInput;
  stillCurrent?: (() => boolean) | undefined;
  localUpdatedAt?: string;
  moveIntent?: ContainerMoveIntentInput | undefined;
  serverTimestamps?:
    | {
        createdAt?: string | null;
        updatedAt?: string | null;
      }
    | undefined;
  updatedAt?: string;
}

export interface SaveContainerWithPendingUpdateOptions
  extends SaveContainerOptions {
  pendingUpdate: PendingUpdateFields;
}

export interface ContainerContentsPersistence
  extends DormantMetadataSweepPersistence {
  containerExists: (execSql: ExecSql, containerId: string) => Promise<boolean>;
  /**
   * Create an absent remotely hydrated container only when no newer durable
   * tombstone or concurrent container/dormant-metadata mutation won first.
   */
  commitHydratedContainer: (
    execSql: ExecSql,
    input: {
      container: ContainerRecord;
      expectedDormantRecord: ContainerMetadataRecord | null;
      /** Tombstone observed before the remote request began, or null. */
      expectedHydrationTombstone?:
        | ContainerHydrationTombstone
        | null
        | undefined;
      purgeDormantMetadata: boolean;
      record: ContainerMetadataRecord;
      remoteUpdatedAt: string;
      saveOptions: {
        localUpdatedAt?: string;
        serverTimestamps?:
          | {
              createdAt?: string | null;
              updatedAt?: string | null;
            }
          | undefined;
      };
      stillCurrent?: (() => boolean) | undefined;
    },
  ) => Promise<
    { committed: true; container: ContainerRecord } | { committed: false }
  >;
  /** Capture anti-resurrection fences immediately before a remote fetch. */
  loadContainerHydrationTombstones: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<ContainerHydrationTombstone>>;
  deleteContainer: (
    execSql: ExecSql,
    containerId: string,
    options?: {
      reason?: ContainerRemoval["reason"];
      updatedAt?: string;
    },
  ) => Promise<void>;
  deleteContainers: (
    execSql: ExecSql,
    removals: ReadonlyArray<ContainerRemoval>,
    options?: {
      /**
       * Request-time states rechecked inside the deletion transaction. An
       * absent or changed row means another pane won and aborts the cascade.
       */
      expectedContainers?: ReadonlyArray<ContainerDeletionGuard>;
      /**
       * Containers whose own container-metadata document (record, queued
       * updates, failure rows) must survive the cascade — the access_revoked
       * branch of docs/sync-edge-cases.md row 4. The metadata re-attaches by
       * container id when access restoration rehydrates the container.
       */
      retainMetadataForContainerIds?: ReadonlyArray<string>;
      stillCurrent?: (() => boolean) | undefined;
    },
  ) => Promise<ReadonlyArray<string>>;
  deletePendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  deletePendingUpdate: (execSql: ExecSql, id: string) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<string>;
  listPendingCreateIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerCreateIntentRecord[]>;
  // Every move intent that has not yet synced, regardless of syncStatus —
  // a blocked move (destination parent not synced yet) is still unsynced, and
  // synced moves are deleted (see markMoveIntentSynced), so every surviving
  // row qualifies. Blocked intents replay too: "blocked" names the reason the
  // last attempt could not proceed, not a terminal verdict.
  listUnsyncedMoveIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerMoveIntentRecord[]>;
  listContainerIdsWithPendingUpdates: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
  ) => Promise<string[]>;
  listContainerIdsWithPullContinuations: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
  ) => Promise<string[]>;
  listPendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<PendingUpdateRecord[]>;
  rekeyPendingUpdate: (execSql: ExecSql, id: string) => Promise<string | null>;
  recordCreateIntentError: (
    execSql: ExecSql,
    input: {
      containerId: string;
      expectedIntentId: string;
      expectedUpdatedAt: string;
      message: string;
    },
  ) => Promise<void>;
  recordMoveIntentError: (
    execSql: ExecSql,
    input: {
      blocked?: boolean | undefined;
      containerId: string;
      expectedIntentId?: string | undefined;
      expectedUpdatedAt?: string | undefined;
      message: string;
    },
  ) => Promise<void>;
  reassignContainerDocuments: (
    execSql: ExecSql,
    input: {
      fromContainerId: string;
      stillCurrent?: (() => boolean) | undefined;
      toContainerId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalRootContainer: (
    execSql: ExecSql,
    input: {
      descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
      localRootContainerId: string;
      remoteOrganizationId: string;
      remoteRootContainerId: string;
      stillCurrent?: (() => boolean) | undefined;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalSystemContainer: (
    execSql: ExecSql,
    input: {
      localContainerId: string;
      remoteContainerId: string;
      remoteOrganizationId: string;
      stillCurrent?: (() => boolean) | undefined;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredContainerState>>;
  loadContainerMetadataState: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<StoredContainerState | null>;
  /**
   * Load a container-metadata record by container id alone, without
   * requiring a containers row — the dormant shape row 4's access_revoked
   * branch leaves behind, re-attached on rehydration.
   */
  loadContainerMetadataRecord: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<ContainerMetadataRecord | null>;
  /**
   * Atomically replace the exact rejected metadata pull continuation with its
   * durable recovery marker and return the authoritative current record.
   */
  invalidateMetadataPullContinuation: (
    execSql: ExecSql,
    input: {
      accessEpoch: number;
      accessStateHash: string | null;
      continuation: DocumentSyncPullContinuation;
      containerId: string;
      contentKeyBundle: string | null;
      documentId: string;
      documentKekTargets: string | null;
      documentManifestBundle: string | null;
      lastCommitLsn: string | null;
    },
  ) => Promise<ContainerMetadataRecord | null>;
  /**
   * Conditionally commit metadata content, its outgoing row, accepted queue
   * settlement, container fields, and the canonical record in one transaction.
   */
  commitMetadataMutation: (
    execSql: ExecSql,
    input: {
      acceptedPendingUpdateIds: readonly string[];
      clearSyncFailure?: boolean | undefined;
      container: ContainerRecord;
      expectedContainer: ContainerRecord;
      expectedRecord: ContainerMetadataRecord;
      createIntentSettlement?:
        | {
            containerId: string;
            expectedIntentId: string;
            expectedUpdatedAt: string;
            remoteContainerId: string;
            remoteMetadataAccessStateHash: string;
            remoteMetadataDocumentId: string;
            /**
             * When present, an overtaking create revision is adopted as the
             * desired local parent and converted to a move from this remotely
             * committed parent instead of rejecting the remote identity.
             */
            supersededMovePreviousParentId?: string | null | undefined;
          }
        | undefined;
      moveIntentSettlement?:
        | {
            containerId: string;
            expectedIntentId: string;
            expectedUpdatedAt: string;
          }
        | undefined;
      pendingUpdate?: PendingUpdateFields | undefined;
      preserveDurableStructureWhenPending?: boolean | undefined;
      record: ContainerMetadataRecord;
      saveOptions?:
        | {
            createIntent?: ContainerCreateIntentInput;
            localUpdatedAt?: string;
            moveIntent?: ContainerMoveIntentInput | undefined;
            serverTimestamps?:
              | {
                  createdAt?: string | null;
                  updatedAt?: string | null;
                }
              | undefined;
            updatedAt?: string;
          }
        | undefined;
      settleAcceptedPendingOnConflict: boolean;
      stillCurrent?: (() => boolean) | undefined;
    },
  ) => Promise<
    | { committed: true; container: ContainerRecord }
    | {
        committed: false;
        currentState: StoredContainerState | null;
        staleServerState?: true;
      }
  >;
  settleAcceptedMetadataPendingUpdates: (
    execSql: ExecSql,
    input: {
      containerId: string;
      expectedRecord: ContainerMetadataRecord;
      pendingUpdateIds: readonly string[];
      stillCurrent?: (() => boolean) | undefined;
    },
  ) => Promise<StoredContainerState | null>;
  /**
   * Destroy a dormant container-metadata scope whose remote metadata document
   * was replaced while access was revoked: its record, queued updates, and
   * failure rows all belong to a dead update stream and must never target the
   * replacement document.
   */
  purgeDormantContainerMetadata: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  saveContainer: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: ContainerMetadataRecord | null,
    options?: SaveContainerOptions,
  ) => Promise<ContainerRecord>;
  /** Atomically saves a container and enqueues its first metadata update. */
  saveContainerWithPendingUpdate: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: ContainerMetadataRecord,
    options: SaveContainerWithPendingUpdateOptions,
  ) => Promise<ContainerRecord>;
  saveContainerAndDeletePendingUpdates: (
    execSql: ExecSql,
    container: ContainerRecord,
    record: ContainerMetadataRecord,
    pendingUpdateIds: readonly string[],
  ) => Promise<ContainerRecord>;
  markCreateIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      // Every enqueue rotates this token; updatedAt is a secondary guard.
      expectedIntentId: string;
      expectedUpdatedAt: string;
      remoteContainerId: string;
      remoteMetadataAccessStateHash: string;
      remoteMetadataDocumentId: string;
      stillCurrent: () => boolean;
      supersededMovePreviousParentId?: string | null | undefined;
    },
  ) => Promise<boolean>;
  markMoveIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      // Every enqueue rotates this token. The timestamp remains a secondary
      // diagnostic guard, but cannot distinguish moves queued in one clock tick.
      expectedIntentId: string;
      expectedUpdatedAt: string;
      stillCurrent: () => boolean;
    },
  ) => Promise<boolean>;
}
