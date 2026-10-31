import type { z } from "zod";
import { attachmentBindDocumentSyncRefinement } from "../documentCreateSeedRefinements";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  arraySchema,
  boundedNonEmptyArraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  positiveIntegerSchema,
  requiredUnknownSchema,
  uuidV4StringSchema,
} from "../schema";
import {
  MAX_INITIATE_PART_UPLOADS,
  MAX_INLINE_CONTAINER_REKEYS,
} from "../util";
import { MultipartBlobPartDescriptorSchema } from "../util/blobTransferSchemas";
import { ContainerMutationRequestSchema } from "./container";
import {
  ContentKeyWrappedKeySchema,
  contentKeyWrappingMetadataSchema,
} from "./contentKeyEnvelopeSchema";
import { ContainerManifestRefArrayArraySchema } from "./document";
import {
  refineSeedWithinSyncRequestLimit,
  refineSingleUpdateSeed,
} from "./documentCreateSeed";
import { DocumentSyncRequestSchema } from "./documentSyncSchema";

export const InitiateMultipartBlobStageRequestSchema = loosePlainObject({
  organizationId: uuidV4StringSchema,
  byteLength: positiveIntegerSchema,
  // The parts the client sends first, so the stage response can carry their
  // upload sources and spare one authorization request per part.
  firstParts: boundedNonEmptyArraySchema(
    MultipartBlobPartDescriptorSchema,
    MAX_INITIATE_PART_UPLOADS,
  ),
  sha256: nonEmptyStringSchema,
});

export type InitiateMultipartBlobStageRequest = z.infer<
  typeof InitiateMultipartBlobStageRequestSchema
>;

export const BlobContentKeyTargetEnvelopeRequestSchema = loosePlainObject({
  bindingId: nonEmptyStringSchema,
  containerId: nonEmptyStringSchema,
  containerKeyEpoch: positiveIntegerSchema,
  containerKeyEpochId: nonEmptyStringSchema,
  containerManifestHash: nonEmptyStringSchema,
  documentId: nonEmptyStringSchema,
  wrappedKey: ContentKeyWrappedKeySchema,
  wrappingMetadata: contentKeyWrappingMetadataSchema("blob"),
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

/**
 * `POST /blobs/{blobId}/attachment-bindings`. The optional `documentSync` is
 * the document's first queued update, held back until its attachment binds;
 * the bind commits it after the binding row under the same checks as a
 * standalone sync, so the upload needs no follow-up sync round trip.
 */
export const BlobAttachmentBindRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
      // The attachment's document link-set manifest is the document's current
      // head. The server resolves it from its own store, while these path refs
      // authorize the write against current container manifests.
      authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema,
      body: requiredUnknownSchema,
      containerRekeys: OptionalContainerRekeysSchema,
      contentKeyBundle: BlobContentKeyBundleRequestSchema,
      documentSync: DocumentSyncRequestSchema.optional(),
      event: plainObjectSchema,
      stagedBlob: BlobStagedBlobRequestSchema.optional(),
    }).superRefine((value, context) => {
      refineSingleUpdateSeed(value.documentSync, context, {
        message:
          "attachment bind document sync requires one update and no container rekeys",
        path: "documentSync",
      });
      refineSeedWithinSyncRequestLimit(
        value.documentSync,
        context,
        "documentSync",
      );
    }),
    [attachmentBindDocumentSyncRefinement],
  );

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
