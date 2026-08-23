import { z } from "zod";
import {
  documentSyncRequestRuntimeRefinements,
  documentSyncResponseRuntimeRefinements,
} from "../documentSyncRefinements";
import {
  DocumentSyncRequestSchema,
  isDocumentSyncRequest,
} from "../request/document";
import {
  DocumentSyncResponseSchema,
  isDocumentSyncResponse,
} from "../response/documentMutation";
import {
  DocumentNotFoundErrorResponseSchema,
  DocumentSyncErrorResponseSchema,
} from "../response/documentSyncError";
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
  failureResponses: {
    404: DocumentNotFoundErrorResponseSchema,
    409: DocumentSyncErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 413, 500, 503],
  id: "documents.sync",
  method: "POST",
  params: DocumentSyncPathParamsSchema,
  path: "/documents/{documentId}/sync",
  responses: {
    200: DocumentSyncResponseSchema,
  },
  runtimeRefinements: [
    ...documentSyncRequestRuntimeRefinements,
    ...documentSyncResponseRuntimeRefinements,
  ],
});

export const isDocumentSyncOperationRequest = isDocumentSyncRequest;

export const isDocumentSyncOperationResponse = isDocumentSyncResponse;
