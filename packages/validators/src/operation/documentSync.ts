import { z } from "zod";
import {
  documentSyncRequestRuntimeRefinements,
  documentSyncResponseRuntimeRefinements,
} from "../documentSyncRefinements";
import {
  DocumentSyncRequestSchema,
  isDocumentSyncRequest,
} from "../request/document";
import { SessionFailureResponseSchema } from "../response/auth/sessionFailure";
import {
  DocumentSyncResponseSchema,
  isDocumentSyncResponse,
} from "../response/documentMutation";
import {
  DocumentNotFoundErrorResponseSchema,
  DocumentSyncErrorResponseSchema,
} from "../response/documentSyncError";
import { ErrorResponseSchema } from "../response/error";
import { PaymentRequiredErrorResponseSchema } from "../response/organizationBilling";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "../util/documentSyncLimits";
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
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    402: PaymentRequiredErrorResponseSchema,
    403: ErrorResponseSchema,
    404: DocumentNotFoundErrorResponseSchema,
    409: DocumentSyncErrorResponseSchema,
    413: ErrorResponseSchema,
    500: ErrorResponseSchema,
    503: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 402, 403, 404, 409, 413, 500, 503],
  id: "documents.sync",
  summary: "Sync encrypted Loro updates",
  description:
    "Uploads encrypted Loro updates with their signed write headers and returns the updates the client is missing from its version vector, one bounded page at a time with a continuation cursor. Writing requires write access through an authorizing container path; reading requires read access. A retried update id is accepted only when its ciphertext and header are identical; 409 responses carry a code that tells the client whether to replan, regenerate, recover, or stop, and 413 means the request is too large.",
  method: "POST",
  params: DocumentSyncPathParamsSchema,
  path: "/documents/{documentId}/sync",
  responseDescriptions: {
    413: `Serialized document sync requests are limited to ${MAX_DOCUMENT_SYNC_REQUEST_BYTES} bytes`,
  },
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
