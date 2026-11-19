import type { DocumentPurgeResponse } from "@tearleads/validators/response";
import type { SyncRemoteDocumentResult } from "../../../data/documents/shared/sync/documentSyncTypes";
import type {
  CreateRemoteDocumentResult,
  RelinkRemoteDocumentResult,
} from "../../../data/documents/shared/types";
import { createRemoteDocument } from "../create";
import type { DocumentSubmissionRequest } from "../create/remoteDocumentCreateRequest";
import {
  type RelinkRemoteDocumentRequest,
  relinkRemoteDocument,
} from "../linkSet/linkSetRemote";
import { type PurgeRemoteDocumentRequest, purgeRemoteDocument } from "../purge";
import { syncRemoteDocument } from "../sync";
import type { SyncRemoteDocumentRequest } from "../sync/remoteDocumentSyncPass";
import type { RemoteDocumentCollaborators } from "./remoteDocumentCollaborators";

/**
 * Document Store & Sync: signed remote document reads and mutations. One
 * instance binds the API client, executor, key material, and remote-sync block
 * of one runtime snapshot; each request carries what varies per call, such as
 * ids, the author, the projection key resolver, and currency checks.
 */
export class RemoteDocumentService {
  private readonly remote: RemoteDocumentCollaborators;

  constructor(collaborators: RemoteDocumentCollaborators) {
    this.remote = collaborators;
  }

  /** Throws when the service has no encapsulation secret key. */
  syncRemoteDocument(
    request: SyncRemoteDocumentRequest,
  ): Promise<SyncRemoteDocumentResult | null> {
    return syncRemoteDocument(this.remote, request);
  }

  /** Throws when the service has no encapsulation secret key. */
  createRemoteDocument(
    request: DocumentSubmissionRequest,
  ): Promise<CreateRemoteDocumentResult | null> {
    return createRemoteDocument(this.remote, request);
  }

  /** Throws when the service has no encapsulation secret key. */
  relinkRemoteDocument(
    request: RelinkRemoteDocumentRequest,
  ): Promise<RelinkRemoteDocumentResult | null> {
    return relinkRemoteDocument(this.remote, request);
  }

  purgeRemoteDocument(
    request: PurgeRemoteDocumentRequest,
  ): Promise<DocumentPurgeResponse | null> {
    return purgeRemoteDocument(this.remote, request);
  }
}
