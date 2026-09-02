import { z } from "zod";
import {
  BlobAttachmentBindRequestSchema,
  BlobAttachmentDetachRequestSchema,
  isBlobAttachmentBindRequest,
  isBlobAttachmentDetachRequest,
} from "../request";
import {
  BlobAttachmentBindResponseSchema,
  BlobAttachmentDetachResponseSchema,
  ErrorResponseSchema,
  isBlobAttachmentBindResponse,
  isBlobAttachmentDetachResponse,
  isListDocumentAttachmentsResponse,
  ListDocumentAttachmentsResponseSchema,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

export const BlobAttachmentPathParamsSchema = z.strictObject({
  blobId: z.string(),
});

export const BlobAttachmentBindingPathParamsSchema = z.strictObject({
  bindingId: z.string(),
  blobId: z.string(),
});

export const DocumentAttachmentsPathParamsSchema = z.strictObject({
  documentId: z.string(),
});

export type BlobAttachmentPathParams = z.infer<
  typeof BlobAttachmentPathParamsSchema
>;
export type BlobAttachmentBindingPathParams = z.infer<
  typeof BlobAttachmentBindingPathParamsSchema
>;
export type DocumentAttachmentsPathParams = z.infer<
  typeof DocumentAttachmentsPathParamsSchema
>;

export const bindBlobAttachmentOperation = defineJsonOperation({
  auth: "session",
  body: BlobAttachmentBindRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "blobs.attachmentBindings.bind",
  method: "POST",
  params: BlobAttachmentPathParamsSchema,
  path: "/blobs/{blobId}/attachment-bindings",
  responses: {
    200: BlobAttachmentBindResponseSchema,
  },
});

export const detachBlobAttachmentOperation = defineJsonOperation({
  auth: "session",
  body: BlobAttachmentDetachRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "blobs.attachmentBindings.detach",
  method: "POST",
  params: BlobAttachmentBindingPathParamsSchema,
  path: "/blobs/{blobId}/attachment-bindings/{bindingId}/detach",
  responses: {
    200: BlobAttachmentDetachResponseSchema,
  },
});

export const listDocumentAttachmentsOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "documents.attachments.list",
  method: "GET",
  params: DocumentAttachmentsPathParamsSchema,
  path: "/documents/{documentId}/attachments",
  responses: {
    200: ListDocumentAttachmentsResponseSchema,
  },
});

export const isBindBlobAttachmentOperationRequest = isBlobAttachmentBindRequest;
export const isBindBlobAttachmentOperationResponse =
  isBlobAttachmentBindResponse;
export const isDetachBlobAttachmentOperationRequest =
  isBlobAttachmentDetachRequest;
export const isDetachBlobAttachmentOperationResponse =
  isBlobAttachmentDetachResponse;
export const isListDocumentAttachmentsOperationResponse =
  isListDocumentAttachmentsResponse;
