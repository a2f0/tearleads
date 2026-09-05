import type { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyArraySchema,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
  requiredUnknownSchema,
} from "../schema";
import { MAX_INLINE_CONTAINER_REKEYS } from "../util";
import { ContainerMutationRequestSchema } from "./container";
import { ContainerManifestRefArrayArraySchema } from "./document";

export const InitiateMultipartBlobStageRequestSchema = loosePlainObject({
  organizationId: nonEmptyStringSchema,
  byteLength: positiveIntegerSchema,
  sha256: nonEmptyStringSchema,
});

export type InitiateMultipartBlobStageRequest = z.infer<
  typeof InitiateMultipartBlobStageRequestSchema
>;

export const MultipartBlobPartCommitRequestSchema = loosePlainObject({
  etag: nonEmptyStringSchema,
  partNumber: positiveIntegerSchema,
});

export type MultipartBlobPartCommitRequest = z.infer<
  typeof MultipartBlobPartCommitRequestSchema
>;

export const CompleteMultipartBlobStageRequestSchema = loosePlainObject({
  parts: nonEmptyArraySchema(MultipartBlobPartCommitRequestSchema),
  uploadId: nonEmptyStringSchema,
});

export type CompleteMultipartBlobStageRequest = z.infer<
  typeof CompleteMultipartBlobStageRequestSchema
>;

export const BlobContentKeyTargetEnvelopeRequestSchema = loosePlainObject({
  bindingId: nonEmptyStringSchema,
  containerId: nonEmptyStringSchema,
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHash: nonEmptyStringSchema,
  documentId: nonEmptyStringSchema,
  wrappedKey: nonEmptyStringSchema,
  wrappingMetadata: plainObjectSchema,
});

export type BlobContentKeyTargetEnvelopeRequest = z.infer<
  typeof BlobContentKeyTargetEnvelopeRequestSchema
>;

export const BlobContentKeyBundleRequestSchema = loosePlainObject({
  contentKeyEpoch: positiveIntegerSchema,
  targetHash: nonEmptyStringSchema,
  targets: arraySchema(BlobContentKeyTargetEnvelopeRequestSchema),
});

export type BlobContentKeyBundleRequest = z.infer<
  typeof BlobContentKeyBundleRequestSchema
>;

export const BlobStagedBlobRequestSchema = loosePlainObject({
  stageId: nonEmptyStringSchema,
  writeHeader: plainObjectSchema,
});

export type BlobStagedBlobRequest = z.infer<typeof BlobStagedBlobRequestSchema>;

const OptionalContainerRekeysSchema = arraySchema(
  ContainerMutationRequestSchema,
  MAX_INLINE_CONTAINER_REKEYS,
).optional();

export const BlobAttachmentBindRequestSchema = loosePlainObject({
  // The attachment's document link-set manifest is the document's current
  // head. The server resolves it from its own store, while these path refs
  // authorize the write against current container manifests.
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema,
  body: requiredUnknownSchema,
  containerRekeys: OptionalContainerRekeysSchema,
  contentKeyBundle: BlobContentKeyBundleRequestSchema,
  event: plainObjectSchema,
  stagedBlob: BlobStagedBlobRequestSchema.optional(),
});

export type BlobAttachmentBindRequest = z.infer<
  typeof BlobAttachmentBindRequestSchema
>;

export const BlobAttachmentDetachRequestSchema = loosePlainObject({
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema,
  body: requiredUnknownSchema,
  containerRekeys: OptionalContainerRekeysSchema,
  event: plainObjectSchema,
});

export type BlobAttachmentDetachRequest = z.infer<
  typeof BlobAttachmentDetachRequestSchema
>;

export function isInitiateMultipartBlobStageRequest(
  value: unknown,
): value is InitiateMultipartBlobStageRequest {
  return InitiateMultipartBlobStageRequestSchema.safeParse(value).success;
}

export function isCompleteMultipartBlobStageRequest(
  value: unknown,
): value is CompleteMultipartBlobStageRequest {
  return CompleteMultipartBlobStageRequestSchema.safeParse(value).success;
}

export function isBlobAttachmentBindRequest(
  value: unknown,
): value is BlobAttachmentBindRequest {
  return BlobAttachmentBindRequestSchema.safeParse(value).success;
}

export function isBlobAttachmentDetachRequest(
  value: unknown,
): value is BlobAttachmentDetachRequest {
  return BlobAttachmentDetachRequestSchema.safeParse(value).success;
}
