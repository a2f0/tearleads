import { z } from "zod";
import {
  documentLinkSetPathRefinement,
  documentSyncRequestRotationRefinement,
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
  DocumentPurgeProofResponseSchema,
  DocumentPurgeResponseSchema,
  ErrorResponseSchema,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
  isDocumentPurgeProofResponse,
  isDocumentPurgeResponse,
  PaymentRequiredErrorResponseSchema,
} from "../response";
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
  401: ErrorResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
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
  method: "POST",
  params: EmptyDocumentMutationPathParamsSchema,
  path: "/documents",
  responses: { 200: DocumentCreateResponseSchema },
});

function defineDocumentLinkSetMutationOperation<
  const Id extends string,
  const Path extends `/${string}`,
>(input: { readonly id: Id; readonly path: Path }) {
  return defineJsonOperation({
    auth: "session",
    body: DocumentLinkSetMutationRequestSchema,
    failureResponses: documentMutationFailureResponses,
    failureStatuses: documentMutationFailureStatuses,
    id: input.id,
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
  path: "/documents/{documentId}/link",
});

export const unlinkDocumentOperation = defineDocumentLinkSetMutationOperation({
  id: "documents.unlink",
  path: "/documents/{documentId}/unlink",
});

export const purgeDocumentOperation = defineJsonOperation({
  auth: "session",
  body: DocumentPurgeRequestSchema,
  failureResponses: documentMutationFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.purge",
  method: "POST",
  params: DocumentMutationPathParamsSchema,
  path: "/documents/{documentId}/purge",
  responses: { 200: DocumentPurgeResponseSchema },
});

export const getDocumentPurgeProofOperation = defineJsonOperation({
  auth: "session",
  failureResponses: documentMutationFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.purgeProof",
  method: "GET",
  params: DocumentMutationPathParamsSchema,
  path: "/documents/{documentId}/purge",
  query: DocumentPurgeProofQuerySchema,
  responses: { 200: DocumentPurgeProofResponseSchema },
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
