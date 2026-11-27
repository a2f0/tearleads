import type { ContainerCreateIntentHold } from "../../containers/shared/createIntentHoldMachine";
import type { CONTAINER_CREATE_INTENT_TYPE } from "../../sqlite/schema";
import type { ExecSql } from "../../sqlite/sqlSchema";

export const CONTAINER_MOVE_INTENT_TYPE = "container.move";

export type ContainerCreateIntentSyncStatus = "pending" | "synced";
export type ContainerMoveIntentSyncStatus = "pending" | "blocked";

export interface ContainerCreateIntentRecord {
  id: string;
  containerId: string;
  parentContainerId: string;
  intentType: typeof CONTAINER_CREATE_INTENT_TYPE;
  syncStatus: ContainerCreateIntentSyncStatus;
  hold: ContainerCreateIntentHold;
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

export interface ContainerCreateIntentErrorInput {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  message: string;
  stillCurrent?: (() => boolean) | undefined;
}

export type ContainerCreateIntentErrorInputRecorder = (
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
) => Promise<void>;

export interface ContainerCreateIntentHoldInput {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  hold: Exclude<ContainerCreateIntentHold, { status: "none" }>;
  stillCurrent?: (() => boolean) | undefined;
}

export type ContainerCreateIntentHoldInputRecorder = (
  execSql: ExecSql,
  input: ContainerCreateIntentHoldInput,
) => Promise<void>;

export interface ContainerMoveIntentRevisionInput {
  containerId: string;
  expectedIntentId: string;
  expectedUpdatedAt: string;
  stillCurrent: () => boolean;
}

export interface ContainerCreateIntentRevisionInput
  extends ContainerMoveIntentRevisionInput {
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
  /** The remote parent now; a move settlement queues cites it as previous. */
  supersededMovePreviousParentId?: string | undefined;
  /**
   * The parent the create committed under. A desired parent equal to it, or
   * to the current one, owes no move: the user never moved the folder away,
   * and a later remote move by another writer stands.
   */
  createdParentContainerId?: string | undefined;
  /** The parent the settled intent wants. */
  desiredParentContainerId?: string | undefined;
}

export interface LocalRootDescendantReparentInput {
  containerId: string;
  parentContainerId: string | null;
  updateCreateIntent?: boolean | undefined;
  /** The moved create waits for a listing of its new parent's children. */
  awaitParentListing?: boolean | undefined;
}
