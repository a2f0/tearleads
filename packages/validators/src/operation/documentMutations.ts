import { z } from "zod";
import {
  documentLinkSetPathRefinement,
  documentSyncRequestRotationRefinement,
} from "../documentSyncRefinements";
import {
  DocumentCreateRequestSchema,
  DocumentLinkSetMutationRequestSchema,
  isDocumentCreateRequest,
  isDocumentLinkSetMutationRequest,
} from "../request";
import {
  DocumentCreateResponseSchema,
  DocumentLinkSetMutationResponseSchema,
  DocumentPurgeResponseSchema,
  ErrorResponseSchema,
  isDocumentCreateResponse,
  isDocumentLinkSetMutationResponse,
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

export const deleteDocumentOperation = defineJsonOperation({
  auth: "session",
  failureResponses: documentMutationFailureResponses,
  failureStatuses: documentMutationFailureStatuses,
  id: "documents.delete",
  method: "DELETE",
  params: DocumentMutationPathParamsSchema,
  path: "/documents/{documentId}",
  responses: { 200: DocumentPurgeResponseSchema },
});

export const isCreateDocumentOperationRequest = isDocumentCreateRequest;
export const isCreateDocumentOperationResponse = isDocumentCreateResponse;
export const isDocumentLinkSetMutationOperationRequest =
  isDocumentLinkSetMutationRequest;
export const isDocumentLinkSetMutationOperationResponse =
  isDocumentLinkSetMutationResponse;
export const isDeleteDocumentOperationResponse = isDocumentPurgeResponse;
