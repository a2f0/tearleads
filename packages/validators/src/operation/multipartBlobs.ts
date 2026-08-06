import { z } from "zod";
import {
  CompleteMultipartBlobStageRequestSchema,
  InitiateMultipartBlobStageRequestSchema,
  isCompleteMultipartBlobStageRequest,
  isInitiateMultipartBlobStageRequest,
} from "../request";
import {
  CompleteMultipartBlobStageResponseSchema,
  ErrorResponseSchema,
  InitiateMultipartBlobStageResponseSchema,
  isCompleteMultipartBlobStageResponse,
  isInitiateMultipartBlobStageResponse,
  isMultipartBlobStageStatusResponse,
  MultipartBlobStageStatusResponseSchema,
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
    401: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 404, 409, 500],
  id: "blobs.multipartStages.initiate",
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
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.multipartStages.get",
  method: "GET",
  params: MultipartBlobStagePathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}",
  responses: {
    200: MultipartBlobStageStatusResponseSchema,
  },
});

export const completeMultipartBlobStageOperation = defineJsonOperation({
  auth: "session",
  body: CompleteMultipartBlobStageRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.multipartStages.complete",
  method: "POST",
  params: MultipartBlobStagePathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}/complete",
  responses: {
    200: CompleteMultipartBlobStageResponseSchema,
  },
});

export const isInitiateMultipartBlobStageOperationRequest =
  isInitiateMultipartBlobStageRequest;
export const isInitiateMultipartBlobStageOperationResponse =
  isInitiateMultipartBlobStageResponse;
export const isGetMultipartBlobStageOperationResponse =
  isMultipartBlobStageStatusResponse;
export const isCompleteMultipartBlobStageOperationRequest =
  isCompleteMultipartBlobStageRequest;
export const isCompleteMultipartBlobStageOperationResponse =
  isCompleteMultipartBlobStageResponse;
