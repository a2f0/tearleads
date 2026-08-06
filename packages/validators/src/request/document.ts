import type { z } from "zod";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";
import {
  AccessManifestBundleWireSchema,
  MAX_INLINE_CONTAINER_REKEYS,
} from "../util";
import { ContainerMutationRequestSchema } from "./container";
import {
  ContainerManifestPathSchema,
  type ContainerManifestRef,
  ContainerManifestRefArrayArraySchema,
  type DocumentContentKeyBundleRequest,
  DocumentContentKeyBundleRequestSchema,
  DocumentOutgoingUpdateSchema,
  type DocumentSyncRequest,
  DocumentSyncRequestSchema,
} from "./documentSyncSchema";

export {
  type ContainerManifestRef,
  ContainerManifestRefArrayArraySchema,
  ContainerManifestRefSchema,
  type DocumentContentKeyBundleRequest,
  DocumentContentKeyBundleRequestSchema,
  type DocumentContentKeyTargetEnvelope,
  DocumentContentKeyTargetEnvelopeSchema,
  type DocumentOutgoingUpdate,
  DocumentOutgoingUpdateSchema,
  type DocumentSyncRequest,
  DocumentSyncRequestSchema,
} from "./documentSyncSchema";

export const documentCreateRequestShape = {
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema.optional(),
  body: requiredUnknownSchema,
  containerRekeys: arraySchema(
    ContainerMutationRequestSchema,
    MAX_INLINE_CONTAINER_REKEYS,
  ).optional(),
  contentKeyBundle: DocumentContentKeyBundleRequestSchema,
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  manifest: plainObjectSchema,
  previousManifest: AccessManifestBundleWireSchema.nullable().optional(),
  targetContainerPathRefs: ContainerManifestPathSchema.optional(),
} satisfies z.ZodRawShape;

export const DocumentCreateRequestSchema = loosePlainObject(
  documentCreateRequestShape,
);

export type DocumentCreateRequest = z.infer<typeof DocumentCreateRequestSchema>;

// The prior link-set manifest is the document's current head. The server
// resolves it from its own store, while the signed event's previous manifest
// hash pins freshness, so the writer does not echo the bundle back.
export const DocumentLinkSetMutationRequestSchema = loosePlainObject({
  authorizingContainerPathRefs: ContainerManifestRefArrayArraySchema,
  body: requiredUnknownSchema,
  containerRekeys: arraySchema(
    ContainerMutationRequestSchema,
    MAX_INLINE_CONTAINER_REKEYS,
  ).optional(),
  contentKeyBundle: DocumentContentKeyBundleRequestSchema,
  event: plainObjectSchema,
  expectedManifestHash: nonEmptyStringSchema,
  manifest: plainObjectSchema,
  rotationBaseline: DocumentOutgoingUpdateSchema.optional(),
  // A container path (root→leaf chain) must carry at least one manifest
  // reference; an empty path authorizes nothing and is never legitimately built.
  targetContainerPathRefs: ContainerManifestPathSchema,
});

export type DocumentLinkSetMutationRequest = z.infer<
  typeof DocumentLinkSetMutationRequestSchema
>;

export function isContainerManifestRefArrayArray(
  value: unknown,
): value is ContainerManifestRef[][] {
  return ContainerManifestRefArrayArraySchema.safeParse(value).success;
}

export function isDocumentContentKeyBundleRequest(
  value: unknown,
): value is DocumentContentKeyBundleRequest {
  return DocumentContentKeyBundleRequestSchema.safeParse(value).success;
}

export function isDocumentCreateRequest(
  value: unknown,
): value is DocumentCreateRequest {
  return DocumentCreateRequestSchema.safeParse(value).success;
}

export function isDocumentLinkSetMutationRequest(
  value: unknown,
): value is DocumentLinkSetMutationRequest {
  return DocumentLinkSetMutationRequestSchema.safeParse(value).success;
}

export function isDocumentSyncRequest(
  value: unknown,
): value is DocumentSyncRequest {
  return DocumentSyncRequestSchema.safeParse(value).success;
}
