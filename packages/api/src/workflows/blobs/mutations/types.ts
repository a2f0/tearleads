import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@symcrypt/validators/request";
import type { BlobAttachmentDetachResponse } from "@symcrypt/validators/response";

type BlobMutationStatus = 400 | 403 | 404 | 409 | 503;

export class BlobMutationError extends Error {
  constructor(
    message: string,
    readonly status: BlobMutationStatus,
  ) {
    super(message);
    this.name = "BlobMutationError";
  }
}

export interface BindBlobAttachmentInput {
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobAttachmentBindRequest;
  /**
   * The authoring session, used only to tag the emitted bind event with an
   * `origin` so the ws router skips echoing the bind back over this session's
   * own socket. Not used by the persistence workflow itself.
   */
  readonly sessionId: string;
  readonly userId: string;
}

export interface PrevalidatedMultipartBlobStage {
  readonly byteLength: number;
  readonly sha256: string;
  readonly stageId: string;
  readonly storageKey: string;
}

export interface DetachBlobAttachmentInput {
  readonly bindingId: string;
  readonly blobId: string;
  readonly fingerprint: string;
  readonly request: BlobAttachmentDetachRequest;
  /** Used to suppress the committed detach hint on the authoring session. */
  readonly sessionId: string;
  readonly userId: string;
}

export interface DetachBlobAttachmentWorkflowResult {
  readonly linkedContainerIds: readonly string[];
  readonly response: BlobAttachmentDetachResponse;
}
