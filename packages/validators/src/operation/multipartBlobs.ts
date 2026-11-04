import { z } from "zod";
import {
  InitiateMultipartBlobStageRequestSchema,
  isInitiateMultipartBlobStageRequest,
} from "../request";
import {
  ErrorResponseSchema,
  InitiateMultipartBlobStageResponseSchema,
  isInitiateMultipartBlobStageResponse,
  isMultipartBlobStageStatusResponse,
  MultipartBlobStageConflictErrorResponseSchema,
  MultipartBlobStageNotFoundErrorResponseSchema,
  MultipartBlobStageStatusResponseSchema,
  SessionFailureResponseSchema,
} from "../response";
import { uuidStringSchema } from "../schema";
import { defineJsonOperation } from "./definition";

const InitiateMultipartBlobStagePathParamsSchema = z.strictObject({});

export const MultipartBlobStagePathParamsSchema = z.strictObject({
  stageId: uuidStringSchema,
});

export type MultipartBlobStagePathParams = z.infer<
  typeof MultipartBlobStagePathParamsSchema
>;

export const initiateMultipartBlobStageOperation = defineJsonOperation({
  auth: "session",
  body: InitiateMultipartBlobStageRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.multipartStages.initiate",
  summary: "Initiate a multipart blob stage",
  description:
    "Opens a blob stage for an encrypted upload, declaring the final byte length, SHA-256 digest, and organization, and returns upload sources for the first parts so they can start at once. The caller must belong to the organization. The stage expires after one hour; nothing becomes readable until an attachment bind promotes it.",
  method: "POST",
  params: InitiateMultipartBlobStagePathParamsSchema,
  path: "/blobs/stages/multipart",
  responses: {
    200: InitiateMultipartBlobStageResponseSchema,
  },
});

export const getMultipartBlobStageOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: MultipartBlobStageNotFoundErrorResponseSchema,
    409: MultipartBlobStageConflictErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.multipartStages.get",
  summary: "Get multipart blob stage status",
  description:
    "Returns a blob stage's status so a client can resume an interrupted upload. Only the exact 404 `multipart_blob_stage_not_found` or 409 `multipart_blob_stage_expired` responses prove the stage is gone and permit starting a fresh one; any other failure means the client should keep its resumable state.",
  method: "GET",
  params: MultipartBlobStagePathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}",
  responses: {
    200: MultipartBlobStageStatusResponseSchema,
  },
});

export const isInitiateMultipartBlobStageOperationRequest =
  isInitiateMultipartBlobStageRequest;
export const isInitiateMultipartBlobStageOperationResponse =
  isInitiateMultipartBlobStageResponse;
export const isGetMultipartBlobStageOperationResponse =
  isMultipartBlobStageStatusResponse;
