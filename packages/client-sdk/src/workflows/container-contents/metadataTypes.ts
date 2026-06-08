import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { ContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import type { DocumentRecord } from "../../data/sqlite/documentPersistence";

export interface ContainerMetadataState {
  container: ContainerRecord;
  doc: ContainerMetadataDocument;
  metadataWriterProjection?:
    | DocumentWriterProjectionResponse
    | null
    | undefined;
  record: DocumentRecord;
}

export interface ContainerMetadataPatch {
  accessEpoch: number;
  accessStateHash: string | null;
  documentId: string | null;
  icon: string | null;
  lastCommitLsn: string | null;
  metadataDocumentId: string | null;
  systemSlot: ContainerRecord["systemSlot"];
  loroSnapshot: string;
  name: string;
  organizationId: string;
  parentId: string | null;
  contentKeyBundle: string | null;
  documentKekTargets: string | null;
  documentManifestBundle: string | null;
}

export interface PersistedContainerMetadataState {
  container: ContainerRecord;
  record: DocumentRecord;
}

export interface SyncedContainerMetadataState
  extends PersistedContainerMetadataState {
  shouldRequestFollowupSync: boolean;
}
