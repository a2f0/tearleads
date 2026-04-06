import { isPlainObject } from "../isPlainObject";
import { hasStringProperty } from "../util";

export interface StageBlobResponse {
  stageId: string;
  expiresAt: string;
}

export interface BlobAttachmentSummary {
  blobId: string;
  slotId: string;
}

export type ListDocumentAttachmentsResponse = BlobAttachmentSummary[];

export interface BlobResponse {
  blobId: string;
  encryptedBytes: string;
}

export function isStageBlobResponse(
  value: unknown,
): value is StageBlobResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "stageId") &&
    hasStringProperty(value, "expiresAt")
  );
}

function isBlobAttachmentSummary(
  value: unknown,
): value is BlobAttachmentSummary {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "slotId")
  );
}

export function isListDocumentAttachmentsResponse(
  value: unknown,
): value is ListDocumentAttachmentsResponse {
  return (
    Array.isArray(value) &&
    value.every((entry) => isBlobAttachmentSummary(entry))
  );
}

export function isBlobResponse(value: unknown): value is BlobResponse {
  return (
    isPlainObject(value) &&
    hasStringProperty(value, "blobId") &&
    hasStringProperty(value, "encryptedBytes")
  );
}
