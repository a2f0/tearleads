import type { DocumentPurgeResponse } from "@tearleads/validators/response";
import type { RelinkRemoteDocumentResult } from "../../../data/documents/shared/types";
import {
  type RelinkRemoteDocumentRequest,
  relinkRemoteDocument,
} from "../linkSet/linkSetRemote";
import { type PurgeRemoteDocumentRequest, purgeRemoteDocument } from "../purge";
import type { RemoteDocumentCollaborators } from "./remoteDocumentCollaborators";

/**
 * Document Store & Sync: signed remote document mutations. One instance binds
 * the API client, executor, and key material of one runtime snapshot; each
 * request carries what varies per call, such as ids, the author, the
 * projection key resolver, and currency checks.
 */
export class RemoteDocumentService {
  private readonly remote: RemoteDocumentCollaborators;

  constructor(collaborators: RemoteDocumentCollaborators) {
    this.remote = collaborators;
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
