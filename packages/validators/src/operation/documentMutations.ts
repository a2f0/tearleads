import { z } from "zod";
import { documentCreateSeedRefinement } from "../documentCreateSeedRefinements";
import {
  documentLinkSetPathRefinement,
  documentSyncRequestRotationRefinement,
  documentSyncRequestRuntimeRefinements,
} from "../documentSyncRefinements";
import { registerJsonSchemaFragment } from "../jsonSchema";
import {
  DocumentCreateRequestSchema,
  DocumentLinkSetMutationRequestSchema,
  DocumentPurgeRequestSchema,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
  isDocumentPurgeRequest,
} from "../request";
import {
  DocumentCreateResponseSchema,
  DocumentLinkSetMutationResponseSchema,
  DocumentMutationFailureResponseSchema,
  DocumentPurgeProofResponseSchema,
  DocumentPurgeResponseSchema,
  ErrorResponseSchema,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeProofResponse,
  isDocumentPurgeResponse,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import {
  PrincipalHistoryPreparationFailureResponseSchema,
  PrincipalHistoryPreparationResponseSchema,
  principalHistoryRollbackRefinement,
} from "../response/principalHistoryPreparation";
import { defineJsonOperation } from "./definition";
import { DocumentSyncPathParamsSchema } from "./documentSync";

const EmptyDocumentMutationPathParamsSchema = z.strictObject({});

export const DocumentMutationPathParamsSchema = DocumentSyncPathParamsSchema;

export type DocumentMutationPathParams = z.infer<
  typeof DocumentMutationPathParamsSchema
>;

const checkpointManifestHashQuerySchema = registerJsonSchemaFragment(
  z.string().min(1).max(6_500),
  { maxLength: 6_500, minLength: 1, type: "string" },
);

export const DocumentPurgeProofQuerySchema = z.strictObject({
  documentCheckpointManifestHash: checkpointManifestHashQuerySchema.optional(),
});

export type DocumentPurgeProofQuery = z.infer<
  typeof DocumentPurgeProofQuerySchema
>;

const documentMutationFailureResponses = {
  400: ErrorResponseSchema,
  401: SessionFailureResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: DocumentMutationFailureResponseSchema,
  409: DocumentMutationFailureResponseSchema,
  500: ErrorResponseSchema,
  503: ErrorResponseSchema,
} as const;

const documentMutationFailureStatuses = [
  400, 401, 402, 403, 404, 409, 500, 503,
] as const;

export const createDocumentOperation = defineJsonOperation({
  auth: "session",
  body: DocumentCreateRequestSchema,
  failureResponses: documentMutationFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.create",
  summary: "Create a document",
  description:
    "Creates a document from a signed document access event, its document link-set manifest, and its content-key bundle, optionally committing the document's first encrypted update in the same transaction. Requires write access to the target container through an authorizing container path. A retry of a create that already committed returns 409 `document_manifest_already_exists`, which lets the client adopt it.",
  method: "POST",
  params: EmptyDocumentMutationPathParamsSchema,
  path: "/documents",
  responses: { 200: DocumentCreateResponseSchema },
  runtimeRefinements: [
    documentCreateSeedRefinement,
    ...documentSyncRequestRuntimeRefinements,
  ],
});

function defineDocumentLinkSetMutationOperation<
  const Id extends string,
  const Path extends `/${string}`,
>(input: {
  readonly id: Id;
  readonly path: Path;
  readonly summary: string;
  readonly description: string;
}) {
  return defineJsonOperation({
    auth: "session",
    body: DocumentLinkSetMutationRequestSchema,
    failureResponses: documentMutationFailureResponses,
    failureStatuses: documentMutationFailureStatuses,
    id: input.id,
    summary: input.summary,
    description: input.description,
    method: "POST",
    params: DocumentMutationPathParamsSchema,
    path: input.path,
    responses: { 200: DocumentLinkSetMutationResponseSchema },
    runtimeRefinements: [
      documentLinkSetPathRefinement,
      documentSyncRequestRotationRefinement,
    ],
  });
}

export const linkDocumentOperation = defineDocumentLinkSetMutationOperation({
  id: "documents.link",
  summary: "Link a document to a container",
  description:
    "Links a document into another container through a signed `document.link` event, advancing its document link-set manifest and rewrapping the content keys of its attached blobs for the new container. Requires write access through the target and authorizing container paths. Stale heads or incomplete rewraps return 409 without changing the document.",
  path: "/documents/{documentId}/link",
});

export const unlinkDocumentOperation = defineDocumentLinkSetMutationOperation({
  id: "documents.unlink",
  summary: "Unlink a document from a container",
  description:
    "Removes a container from a document's link set through a signed `document.unlink` event and rotates the document content key. The request must carry a rotation baseline covering every committed update, unless the document has none. Requires write access; stale heads, a missing baseline, or incomplete rewraps return 409.",
  path: "/documents/{documentId}/unlink",
});

const documentPurgeFailureResponses = {
  ...documentMutationFailureResponses,
  503: PrincipalHistoryPreparationFailureResponseSchema,
} as const;

const preparationResponseDescriptions = {
  202: "The attempted operation rolled back. Retry the identical request to continue verification preparation.",
} as const;

export const purgeDocumentOperation = defineJsonOperation({
  auth: "session",
  body: DocumentPurgeRequestSchema,
  failureResponses: documentPurgeFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.purge",
  summary: "Purge a document",
  description:
    "Permanently removes a document through a signed `document.purge` event that cites its exact current authorizing container path. Requires write access, a document linked to exactly one container, and a document that is not a container's metadata document. The server keeps the signed proof, and blobs only this document referenced enter the attachment-retention grace period; a 202 asks the client to retry the identical request after policy history is prepared.",
  method: "POST",
  params: DocumentMutationPathParamsSchema,
  path: "/documents/{documentId}/purge",
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: DocumentPurgeResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [principalHistoryRollbackRefinement],
});

export const getDocumentPurgeProofOperation = defineJsonOperation({
  auth: "session",
  failureResponses: documentPurgeFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.purgeProof",
  summary: "Get a document purge proof",
  description:
    "Returns the retained signed proof that a document was purged, so a device can verify the deletion before removing its local copy. Only callers who were authorized through the purge-time container path are served it; a 202 asks the client to retry the identical request after policy history is prepared.",
  method: "GET",
  params: DocumentMutationPathParamsSchema,
  path: "/documents/{documentId}/purge",
  query: DocumentPurgeProofQuerySchema,
  responseDescriptions: preparationResponseDescriptions,
  responses: {
    200: DocumentPurgeProofResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [principalHistoryRollbackRefinement],
});

export const isCreateDocumentOperationRequest = isDocumentCreateRequest;
export const isCreateDocumentOperationResponse = isDocumentCreateResponse;
export const isDocumentLinkSetMutationOperationRequest =
  isDocumentLinkSetMutationRequest;
export const isDocumentLinkSetMutationOperationResponse =
  isDocumentLinkSetMutationResponse;
export const isPurgeDocumentOperationRequest = isDocumentPurgeRequest;
export const isPurgeDocumentOperationResponse = isDocumentPurgeResponse;
export const isGetDocumentPurgeProofOperationResponse =
  isDocumentPurgeProofResponse;
