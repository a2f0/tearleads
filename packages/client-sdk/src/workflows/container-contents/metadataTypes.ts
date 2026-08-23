import type { DocumentWriterProjectionResponse } from "@symcrypt/validators/response";
import type { ContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { ContainerMetadataRecord } from "../../data/persistence/container-contents/containerContentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";

export interface ContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  metadataWriterProjection?:
    | DocumentWriterProjectionResponse
    | null
    | undefined;
  /** In-memory continuation for the current bounded metadata pull. */
  pullCursor?: string | null | undefined;
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
  documentId: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  systemSlot: ContainerRecord["systemSlot"];
  metadataUpdates: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

export interface PersistedContainerMetadataState {
  container: ContainerRecord;
  record: ContainerMetadataRecord;
}

export interface SyncedContainerMetadataState
  extends PersistedContainerMetadataState {
  shouldRequestFollowupSync: boolean;
}
