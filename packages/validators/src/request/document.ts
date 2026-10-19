import type { z } from "zod";
import { documentCreateSeedRefinement } from "../documentCreateSeedRefinements";
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
  MAX_CONTAINER_PATH_LENGTH,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATH_REFS,
  MAX_DOCUMENT_SYNC_AUTHORIZATION_PATHS,
  MAX_INLINE_CONTAINER_REKEYS,
} from "../util";
import { ContainerMutationRequestSchema } from "./container";
import { refineSingleUpdateSeed } from "./documentCreateSeed";
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
  targetContainerPathRefs: ContainerManifestPathSchema.optional(),
} satisfies z.ZodRawShape;

/** A document create with no seed: a container's metadata document. */
export const DocumentCreateBaseRequestSchema = loosePlainObject(
  documentCreateRequestShape,
);

/**
 * `POST /documents`. The optional seed is the create's first queued update,
 * committed in the create transaction under the same checks as a standalone
 * sync, so a new document needs no follow-up sync round trip.
 */
export const DocumentCreateRequestSchema = registerJsonSchemaRuntimeRefinements(
  loosePlainObject({
    ...documentCreateRequestShape,
    initialSync: DocumentSyncRequestSchema.optional(),
  }).superRefine((value, context) => {
    refineSingleUpdateSeed(value.initialSync, context, {
      message:
        "document create seed requires one update and no container rekeys",
      path: "initialSync",
    });
  }),
  [documentCreateSeedRefinement],
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
        request.targetContainerPathRefs.length > MAX_CONTAINER_PATH_LENGTH ||
        request.authorizingContainerPathRefs.some(
          (path) =>
            !Array.isArray(path) || path.length > MAX_CONTAINER_PATH_LENGTH,
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
