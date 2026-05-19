import type {
  BlobAttachmentBindRequest,
  BlobAttachmentDetachRequest,
} from "@tearleads/validators/request";

export type BlobMutationStatus = 400 | 403 | 404 | 409 | 503;

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
  readonly userId: string;
}
