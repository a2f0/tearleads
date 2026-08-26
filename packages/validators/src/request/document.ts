import type { z } from "zod";
import { documentLinkSetPathRefinement } from "../documentSyncRefinements";
import { registerJsonSchemaRuntimeRefinements } from "../jsonSchema";
import {
  arraySchema,
  loosePlainObject,
  nonEmptyStringSchema,
  plainObjectSchema,
  requiredUnknownSchema,
} from "../schema";
import {
  AccessManifestBundleWireSchema,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS,
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
export const DocumentLinkSetMutationRequestSchema =
  registerJsonSchemaRuntimeRefinements(
    loosePlainObject({
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
    }).superRefine((request, context) => {
      if (
        !Array.isArray(request.authorizingContainerPathRefs) ||
        !Array.isArray(request.targetContainerPathRefs)
      ) {
        return;
      }
      // The nested schemas have already reported their shape/cardinality
      // errors. Keep this aggregate refinement bounded and never dereference a
      // malformed path after those continuable issues have been replayed.
      if (
        request.authorizingContainerPathRefs.length >
          MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS ||
        request.targetContainerPathRefs.length >
          MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH ||
        request.authorizingContainerPathRefs.some(
          (path) =>
            !Array.isArray(path) ||
            path.length > MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_DEPTH,
        )
      ) {
        return;
      }
      const totalReferences = request.authorizingContainerPathRefs.reduce(
        (total, path) => total + path.length,
        request.targetContainerPathRefs.length,
      );
      if (totalReferences > MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS) {
        context.addIssue({
          code: "custom",
          message: documentLinkSetPathRefinement.description,
          path: ["authorizingContainerPathRefs"],
        });
      }
    }),
    [documentLinkSetPathRefinement],
  );

export type DocumentLinkSetMutationRequest = z.infer<
  typeof DocumentLinkSetMutationRequestSchema
>;

export const DocumentPurgeRequestSchema = loosePlainObject({
  authorizingContainerPathRefs: ContainerManifestPathSchema,
  body: requiredUnknownSchema,
  event: plainObjectSchema,
});

export type DocumentPurgeRequest = z.infer<typeof DocumentPurgeRequestSchema>;

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

export function isDocumentPurgeRequest(
  value: unknown,
): value is DocumentPurgeRequest {
  return DocumentPurgeRequestSchema.safeParse(value).success;
}

export function isDocumentSyncRequest(
  value: unknown,
): value is DocumentSyncRequest {
  return DocumentSyncRequestSchema.safeParse(value).success;
}
