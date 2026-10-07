import { z } from "zod";
import { projectionHistoryHeaderRefinement } from "../projectionHistoryRefinements";
import {
  ContainerNotFoundErrorResponseSchema,
  ContainerWriterProjectionErrorResponseSchema,
  ContainerWriterProjectionResponseSchema,
  DocumentNotFoundErrorResponseSchema,
  DocumentWriterProjectionErrorResponseSchema,
  DocumentWriterProjectionResponseSchema,
  ErrorResponseSchema,
  isContainerWriterProjectionResponse,
  isDocumentWriterProjectionResponse,
  SessionFailureResponseSchema,
} from "../response";
import { PrincipalHistoryPreparationResponseSchema } from "../response/principalHistoryPreparation";
import { ProjectionHistoryHeadersSchema } from "../util/projectionHistoryWire";
import { writerProjectionResponseRuntimeRefinements } from "../writerProjectionRefinements";
import { defineJsonOperation } from "./definition";

export const ContainerWriterProjectionPathParamsSchema = z.strictObject({
  containerId: z.string(),
});

export const DocumentWriterProjectionPathParamsSchema = z.strictObject({
  documentId: z.string(),
});

export type ContainerWriterProjectionPathParams = z.infer<
  typeof ContainerWriterProjectionPathParamsSchema
>;
export type DocumentWriterProjectionPathParams = z.infer<
  typeof DocumentWriterProjectionPathParamsSchema
>;

export const getContainerWriterProjectionOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ContainerNotFoundErrorResponseSchema,
    409: ContainerWriterProjectionErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "containers.writerProjection.get",
  method: "GET",
  headers: ProjectionHistoryHeadersSchema,
  params: ContainerWriterProjectionPathParamsSchema,
  path: "/containers/{containerId}/writer-projection",
  responses: {
    200: ContainerWriterProjectionResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    ...writerProjectionResponseRuntimeRefinements,
    projectionHistoryHeaderRefinement,
  ],
});

export const getDocumentWriterProjectionOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: DocumentNotFoundErrorResponseSchema,
    409: DocumentWriterProjectionErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "documents.writerProjection.get",
  method: "GET",
  headers: ProjectionHistoryHeadersSchema,
  params: DocumentWriterProjectionPathParamsSchema,
  path: "/documents/{documentId}/writer-projection",
  responses: {
    200: DocumentWriterProjectionResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    ...writerProjectionResponseRuntimeRefinements,
    projectionHistoryHeaderRefinement,
  ],
});

export const isGetContainerWriterProjectionOperationResponse =
  isContainerWriterProjectionResponse;
export const isGetDocumentWriterProjectionOperationResponse =
  isDocumentWriterProjectionResponse;
