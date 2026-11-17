import type { DocumentPurgeRequest } from "@tearleads/validators/request";
import type {
  DocumentPurgeProofResponse,
  DocumentPurgeResponse,
} from "@tearleads/validators/response";
import type { DocumentSyncApi } from "../../../data/documents/shared/sync/documentSyncTypes";
import type {
  DocumentCreateApi,
  DocumentLinkSetMutationApi,
} from "../../../data/documents/shared/types";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import type { WorkflowRuntimeUtilInput } from "../../shared/runtimeInput";

export interface DocumentPurgeApi {
  getDocumentPurgeProof(
    documentId: string,
    options?: {
      readonly documentCheckpointManifestHash?: string;
    },
    requestOptions?: {
      readonly expectedPaymentRequiredOrganizationId?: string;
    },
  ): Promise<DocumentPurgeProofResponse | null>;
  getDocumentWriterProjectionResult: NonNullable<
    DocumentSyncApi["getDocumentWriterProjectionResult"]
  >;
  purgeDocument(
    documentId: string,
    request: DocumentPurgeRequest,
    options?: {
      readonly expectedPaymentRequiredOrganizationId?: string;
    },
  ): Promise<DocumentPurgeResponse | null>;
}

/** The API slices a `RemoteDocumentService` calls. */
export type RemoteDocumentServiceApi = DocumentSyncApi &
  DocumentCreateApi &
  DocumentLinkSetMutationApi &
  DocumentPurgeApi;

/**
 * What a `RemoteDocumentService` binds for its lifetime, one runtime snapshot:
 * the API client, executor, key material, and remote-sync block that snapshot
 * carries, so a call never mixes one snapshot's executor with another's key.
 */
export interface RemoteDocumentCollaborators {
  readonly api: RemoteDocumentServiceApi;
  readonly execSql: ExecSql;
  /** The local identity's encapsulation secret key; null before it has one. */
  readonly encapsulationSecretKey: Uint8Array | null;
  /**
   * Reports an organization whose remote sync is held: its writes for a
   * billing block, both directions for a sync pause.
   */
  readonly isRemoteSyncBlocked?: WorkflowRuntimeUtilInput["isRemoteSyncBlocked"];
}
