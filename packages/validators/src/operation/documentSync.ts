import { z } from "zod";
import {
  DocumentSyncRequestSchema,
  isDocumentSyncRequest,
} from "../request/document";
import {
  DocumentSyncResponseSchema,
  isDocumentSyncResponse,
} from "../response/documentMutation";
import { defineJsonOperation } from "./definition";

export const DocumentSyncPathParamsSchema = z.strictObject({
  documentId: z.string(),
});

export type DocumentSyncPathParams = z.infer<
  typeof DocumentSyncPathParamsSchema
>;

export const documentSyncOperation = defineJsonOperation({
  auth: "session",
  body: DocumentSyncRequestSchema,
  failureStatuses: [400, 401, 402, 403, 404, 409, 500, 503],
  id: "documents.sync",
  method: "POST",
  params: DocumentSyncPathParamsSchema,
  path: "/documents/{documentId}/sync",
  responses: {
    200: DocumentSyncResponseSchema,
  },
});

export const isDocumentSyncOperationRequest = isDocumentSyncRequest;

export const isDocumentSyncOperationResponse = isDocumentSyncResponse;
