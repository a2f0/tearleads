import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import type { ContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { DocumentSyncPullContinuation } from "../../data/documents/shared/syncPagination";
import type { ContainerMetadataRecord } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";

export interface ContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  metadataWriterProjection?:
    | DocumentWriterProjectionResponse
    | null
    | undefined;
  /** Durable continuation mirrored from the metadata document record. */
  pullContinuation?: DocumentSyncPullContinuation | null | undefined;
  record: ContainerMetadataRecord;
  /**
   * Consecutive completed sync passes that re-keyed conflicted pending updates
   * without settling anything; bounds the rekey-driven follow-up sync. See
   * shouldReArmAfterOutgoingSettlement.
   */
  rekeyOnlyPassCount?: number | undefined;
}

export interface ContainerMetadataPatch {
  accessEpoch: number;
  accessStateHash: string | null;
  effectiveAccessLevel: ContainerRecord["effectiveAccessLevel"];
  documentId: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  systemSlot: ContainerRecord["systemSlot"];
  metadataUpdates: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  pullContinuation: DocumentSyncPullContinuation | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

export interface PersistedContainerMetadataState {
  container: ContainerRecord;
  mutationSuperseded?: true;
  pullContinuationSuperseded?: true;
  record: ContainerMetadataRecord;
  syncIdentitySuperseded?: true;
}

export interface SyncedContainerMetadataState
  extends PersistedContainerMetadataState {
  shouldRequestFollowupSync: boolean;
}

export interface MissingContainerMetadataState {
  missing: true;
}
