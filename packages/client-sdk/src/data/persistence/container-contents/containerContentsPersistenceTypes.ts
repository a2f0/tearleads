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

export interface ContainerContentsPersistence
  extends DormantMetadataSweepPersistence {
  containerExists: (execSql: ExecSql, containerId: string) => Promise<boolean>;
  deleteContainer: (
    execSql: ExecSql,
    containerId: string,
    options?: { updatedAt?: string },
  ) => Promise<void>;
  deleteContainers: (
    execSql: ExecSql,
    containerIds: ReadonlyArray<string>,
    options?: {
      /**
       * Containers whose own container-metadata document (record, queued
       * updates, failure rows) must survive the cascade — the access_revoked
       * branch of docs/sync-edge-cases.md row 4. The metadata re-attaches by
       * container id when access restoration rehydrates the container.
       */
      retainMetadataForContainerIds?: ReadonlyArray<string>;
      updatedAt?: string;
    },
  ) => Promise<void>;
  deletePendingUpdates: (
    execSql: ExecSql,
    containerId: string,
  ) => Promise<void>;
  ensureSchema: (execSql: ExecSql) => Promise<void>;
  enqueuePendingUpdate: (
    execSql: ExecSql,
    input: PendingUpdateFields & { containerId: string },
  ) => Promise<void>;
  listPendingCreateIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerCreateIntentRecord[]>;
  listPendingMoveIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerMoveIntentRecord[]>;
  // Every move intent that has not yet synced, regardless of syncStatus —
  // a blocked move (destination parent not synced yet) is still unsynced.
  // Synced moves are deleted, so any surviving row qualifies. Use this where a
  // 'pending'-only view would miss blocked intents (e.g. hydration must not
  // revert a blocked local move's parent to the server value).
  listUnsyncedMoveIntents: (
    execSql: ExecSql,
  ) => Promise<ContainerMoveIntentRecord[]>;
  listContainerIdsWithPendingUpdates: (
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
    containerId: string,
    message: string,
  ) => Promise<void>;
  recordMoveIntentError: (
    execSql: ExecSql,
    input: {
      blocked?: boolean | undefined;
      containerId: string;
      message: string;
    },
  ) => Promise<void>;
  reassignContainerDocuments: (
    execSql: ExecSql,
    input: {
      fromContainerId: string;
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
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  reconcileLocalSystemContainer: (
    execSql: ExecSql,
    input: {
      localContainerId: string;
      remoteContainerId: string;
      remoteOrganizationId: string;
      updatedAt?: string | undefined;
    },
  ) => Promise<void>;
  loadContainers: (
    execSql: ExecSql,
  ) => Promise<ReadonlyArray<StoredContainerState>>;
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
    options?: {
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
    },
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
      // The intent row's updatedAt snapshotted when the pass listed it. The
      // mark is a no-op if the row changed since (a user re-queued the intent
      // across the create network await), so the re-queued intent stays pending.
      expectedUpdatedAt: string;
      remoteContainerId: string;
      remoteMetadataAccessStateHash: string;
      remoteMetadataDocumentId: string;
    },
  ) => Promise<void>;
  markMoveIntentSynced: (
    execSql: ExecSql,
    input: {
      containerId: string;
      // See markCreateIntentSynced: guards the delete against a move re-queued
      // during the network round-trip so the new destination is not discarded.
      expectedUpdatedAt: string;
    },
  ) => Promise<void>;
}
