import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";

export const MultipartBlobStagePartSchema = loosePlainObject({
  byteLength: positiveIntegerSchema,
  etag: nonEmptyStringSchema,
  partNumber: positiveIntegerSchema,
});

export type MultipartBlobStagePart = z.infer<
  typeof MultipartBlobStagePartSchema
>;

export const InitiateMultipartBlobStageResponseSchema = loosePlainObject({
  byteLength: positiveIntegerSchema,
  expiresAt: z.string(),
  sha256: nonEmptyStringSchema,
  stageId: z.string(),
  uploadedParts: arraySchema(MultipartBlobStagePartSchema),
  uploadId: z.string(),
});

export type InitiateMultipartBlobStageResponse = z.infer<
  typeof InitiateMultipartBlobStageResponseSchema
>;

export const MultipartBlobStageStatusResponseSchema = loosePlainObject({
  byteLength: positiveIntegerSchema,
  completed: z.boolean(),
  expiresAt: z.string(),
  sha256: nonEmptyStringSchema,
  stageId: z.string(),
  uploadedParts: arraySchema(MultipartBlobStagePartSchema),
  uploadId: z.string(),
});

export type MultipartBlobStageStatusResponse = z.infer<
  typeof MultipartBlobStageStatusResponseSchema
>;

export const UploadMultipartBlobPartResponseSchema = loosePlainObject({
  part: MultipartBlobStagePartSchema,
  stageId: z.string(),
  uploadId: z.string(),
});

export type UploadMultipartBlobPartResponse = z.infer<
  typeof UploadMultipartBlobPartResponseSchema
>;

export const CompleteMultipartBlobStageResponseSchema = loosePlainObject({
  byteLength: positiveIntegerSchema,
  expiresAt: z.string(),
  sha256: nonEmptyStringSchema,
  stageId: z.string(),
});

export type CompleteMultipartBlobStageResponse = z.infer<
  typeof CompleteMultipartBlobStageResponseSchema
>;

export const BlobContentKeyTargetEnvelopeResponseSchema = loosePlainObject({
  bindingId: z.string(),
  containerId: z.string(),
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: z.string(),
  containerManifestHash: z.string(),
  documentId: z.string(),
  wrappedKey: z.string(),
  wrappingMetadata: plainObjectSchema,
});

export type BlobContentKeyTargetEnvelopeResponse = z.infer<
  typeof BlobContentKeyTargetEnvelopeResponseSchema
>;

export const BlobContentKeyBundleResponseSchema = loosePlainObject({
  blobId: z.string(),
  contentKeyEpoch: positiveIntegerSchema,
  targetHash: z.string(),
  targets: arraySchema(BlobContentKeyTargetEnvelopeResponseSchema),
});

export type BlobContentKeyBundleResponse = z.infer<
  typeof BlobContentKeyBundleResponseSchema
>;

export const BlobAttachmentSummarySchema = loosePlainObject({
  bindingId: z.string(),
  blobId: z.string(),
  contentKeyBundle: BlobContentKeyBundleResponseSchema,
  slotId: z.string(),
});

export type BlobAttachmentSummary = z.infer<typeof BlobAttachmentSummarySchema>;

export const ListDocumentAttachmentsResponseSchema = arraySchema(
  BlobAttachmentSummarySchema,
);

export type ListDocumentAttachmentsResponse = z.infer<
  typeof ListDocumentAttachmentsResponseSchema
>;

export const BlobKekTargetsResponseSchema = loosePlainObject({
  activeBindingIds: arraySchema(z.string()),
  blobAccessManifestHash: z.string(),
  blobId: z.string(),
  blobKeyTargetHash: z.string(),
  documentManifestHashes: arraySchema(z.string()),
  linkedContainerKeyEpochIds: arraySchema(z.string()),
  linkedContainerManifestHashes: arraySchema(z.string()),
  organizationId: z.string(),
  targets: arraySchema(plainObjectSchema),
});

export type BlobKekTargetsResponse = z.infer<
  typeof BlobKekTargetsResponseSchema
>;

export const BlobAttachmentBindResponseSchema = loosePlainObject({
  bindingId: z.string(),
  blobId: z.string(),
  blobKekTargets: BlobKekTargetsResponseSchema,
  contentKeyBundle: BlobContentKeyBundleResponseSchema,
  documentId: z.string(),
  slotId: z.string(),
  writeHeaderHash: z.string().optional(),
});

export type BlobAttachmentBindResponse = z.infer<
  typeof BlobAttachmentBindResponseSchema
>;

export const BlobAttachmentDetachResponseSchema = loosePlainObject({
  bindingId: z.string(),
  blobId: z.string(),
  documentId: z.string(),
  slotId: z.string(),
});

export type BlobAttachmentDetachResponse = z.infer<
  typeof BlobAttachmentDetachResponseSchema
>;

export function isInitiateMultipartBlobStageResponse(
  value: unknown,
): value is InitiateMultipartBlobStageResponse {
  return InitiateMultipartBlobStageResponseSchema.safeParse(value).success;
}

export function isMultipartBlobStageStatusResponse(
  value: unknown,
): value is MultipartBlobStageStatusResponse {
  return MultipartBlobStageStatusResponseSchema.safeParse(value).success;
}

export function isUploadMultipartBlobPartResponse(
  value: unknown,
): value is UploadMultipartBlobPartResponse {
  return UploadMultipartBlobPartResponseSchema.safeParse(value).success;
}

export function isCompleteMultipartBlobStageResponse(
  value: unknown,
): value is CompleteMultipartBlobStageResponse {
  return CompleteMultipartBlobStageResponseSchema.safeParse(value).success;
}

export function isListDocumentAttachmentsResponse(
  value: unknown,
): value is ListDocumentAttachmentsResponse {
  return ListDocumentAttachmentsResponseSchema.safeParse(value).success;
}

export function isBlobAttachmentBindResponse(
  value: unknown,
): value is BlobAttachmentBindResponse {
  return BlobAttachmentBindResponseSchema.safeParse(value).success;
}

export function isBlobAttachmentDetachResponse(
  value: unknown,
): value is BlobAttachmentDetachResponse {
  return BlobAttachmentDetachResponseSchema.safeParse(value).success;
}
