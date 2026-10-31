import { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
} from "../schema";
import { AccessEventBundleWireResponseSchema } from "../util";
import { MultipartBlobPartUploadSchema } from "../util/blobTransferSchemas";
import { DocumentCreateSeedResponseSchema } from "./documentMutation";

export const MultipartBlobStagePartSchema = loosePlainObject({
  byteLength: positiveIntegerSchema,
  etag: nonEmptyStringSchema,
  partNumber: positiveIntegerSchema,
});

export type MultipartBlobStagePart = z.infer<
  typeof MultipartBlobStagePartSchema
>;

export const InitiateMultipartBlobStageResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  byteLength: positiveIntegerSchema,
  expiresAt: z.string(),
  // One upload source per requested first part, in request order.
  partUploads: arraySchema(MultipartBlobPartUploadSchema),
  sha256: nonEmptyStringSchema,
  stageId: z.string(),
  uploadedParts: arraySchema(MultipartBlobStagePartSchema),
  uploadId: z.string(),
});

export type InitiateMultipartBlobStageResponse = z.infer<
  typeof InitiateMultipartBlobStageResponseSchema
>;

export const MultipartBlobStageStatusResponseSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
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

export const BlobAttachmentSummarySchema = loosePlainObject({
  bindingEvent: AccessEventBundleWireResponseSchema,
  bindingId: z.string(),
  blobId: z.string(),
  blobKekTargets: BlobKekTargetsResponseSchema,
  contentKeyBundle: BlobContentKeyBundleResponseSchema,
  documentManifestHash: z.string(),
  previousBindingId: z.string().nullable(),
  slotId: z.string(),
  writeAuthorization: BlobKekTargetsResponseSchema,
  writeHeader: plainObjectSchema,
});

export type BlobAttachmentSummary = z.infer<typeof BlobAttachmentSummarySchema>;

export const ListDocumentAttachmentsResponseSchema = arraySchema(
  BlobAttachmentSummarySchema,
);

export type ListDocumentAttachmentsResponse = z.infer<
  typeof ListDocumentAttachmentsResponseSchema
>;

/**
 * A bind acknowledges by hash: the signed binding event's hash, the stored
 * content-key epoch, and the verified write header's hash, beside the
 * server-resolved KEK targets. It never echoes the signed event, the
 * content-key wraps, the write header, or the write authorization (which a
 * staged upload's bind stores as exactly those targets); the client compares
 * each with what it signed.
 */
export const BlobAttachmentBindResponseSchema = loosePlainObject({
  bindingId: z.string(),
  blobId: z.string(),
  blobKekTargets: BlobKekTargetsResponseSchema,
  contentKeyEpoch: positiveIntegerSchema,
  documentId: z.string(),
  documentManifestHash: z.string(),
  eventHash: nonEmptyStringSchema,
  previousBindingId: z.string().nullable(),
  slotId: z.string(),
  writeHeaderHash: z.string(),
  /** Present exactly when the request carried `documentSync`. */
  documentSync: DocumentCreateSeedResponseSchema.optional(),
});

export type BlobAttachmentBindResponse = z.infer<
  typeof BlobAttachmentBindResponseSchema
>;

/**
 * The listing entry a staged upload's bind committed, rebuilt from the
 * request it acknowledged: the bind stores exactly the signed event,
 * content-key bundle, and write header the request carried, with the
 * resolved KEK targets as the write authorization. Callers must first have
 * matched the acknowledgement against that request.
 */
export function blobAttachmentSummaryFromStagedBind(
  request: {
    readonly body: unknown;
    readonly contentKeyBundle: {
      readonly targetHash: string;
      readonly targets: readonly BlobContentKeyTargetEnvelopeResponse[];
    };
    readonly event: Record<string, unknown>;
    readonly stagedBlob: { readonly writeHeader: Record<string, unknown> };
  },
  response: BlobAttachmentBindResponse,
): BlobAttachmentSummary {
  return {
    bindingEvent: {
      body: request.body,
      event: request.event,
      eventHash: response.eventHash,
    },
    bindingId: response.bindingId,
    blobId: response.blobId,
    blobKekTargets: response.blobKekTargets,
    contentKeyBundle: {
      blobId: response.blobId,
      contentKeyEpoch: response.contentKeyEpoch,
      targetHash: request.contentKeyBundle.targetHash,
      targets: [...request.contentKeyBundle.targets],
    },
    documentManifestHash: response.documentManifestHash,
    previousBindingId: response.previousBindingId,
    slotId: response.slotId,
    writeAuthorization: response.blobKekTargets,
    writeHeader: request.stagedBlob.writeHeader,
  };
}

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
