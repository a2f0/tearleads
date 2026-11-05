import { z } from "zod";
import { attachmentBindDocumentSyncRefinement } from "../documentCreateSeedRefinements";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import {
  BlobAttachmentBindRequestSchema,
  BlobAttachmentDetachRequestSchema,
  isBlobAttachmentBindRequest,
  isBlobAttachmentDetachRequest,
} from "../request";
import {
  BlobAttachmentBindResponseSchema,
  BlobAttachmentDetachResponseSchema,
  BlobMutationFailureResponseSchema,
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
    409: BlobMutationFailureResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "blobs.attachmentBindings.bind",
  summary: "Bind or replace a blob attachment",
  description:
    "Attaches an encrypted blob to an attachment slot in a document, or replaces the slot's current binding, through a signed `attachment.bind` event. When it names a blob stage, the server assembles and verifies the staged upload and promotes it to committed blob storage; this is the only way to complete an upload. Requires write access through an authorizing container path; a stale binding or path head returns 409, and an organization without active billing returns 402.",
  method: "POST",
  params: BlobAttachmentPathParamsSchema,
  path: "/blobs/{blobId}/attachment-bindings",
  responses: {
    200: BlobAttachmentBindResponseSchema,
  },
  runtimeRefinements: [
    attachmentBindDocumentSyncRefinement,
    ...documentSyncRequestRuntimeRefinements,
  ],
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
    409: BlobMutationFailureResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "blobs.attachmentBindings.detach",
  summary: "Detach a blob attachment",
  description:
    "Removes an active attachment binding from its document slot through a signed `attachment.detach` event. Requires write access through an authorizing container path. A blob left with no active binding is kept for the attachment-retention grace period before garbage collection.",
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
  summary: "List active document attachments",
  description:
    "Lists a document's active attachment bindings with each blob's signed binding event, signed write header, and blob content-key bundle, which clients need to decrypt the blob. Requires read access through a linked container path.",
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
