import { z } from "zod";
import { knownManifestsHeaderRefinement } from "../knownManifestsRefinements";
import {
  ContainerNotFoundErrorResponseSchema,
  ContainerWriterProjectionErrorResponseSchema,
  ContainerWriterProjectionWireResponseSchema,
  DocumentNotFoundErrorResponseSchema,
  DocumentWriterProjectionErrorResponseSchema,
  DocumentWriterProjectionWireResponseSchema,
  ErrorResponseSchema,
  isContainerWriterProjectionWireResponse,
  isDocumentWriterProjectionWireResponse,
  SessionFailureResponseSchema,
} from "../response";
import { PrincipalHistoryPreparationResponseSchema } from "../response/principalHistoryPreparation";
import { KnownManifestsHeadersSchema } from "../util/knownManifestWire";
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
  headers: KnownManifestsHeadersSchema,
  params: ContainerWriterProjectionPathParamsSchema,
  path: "/containers/{containerId}/writer-projection",
  responses: {
    200: ContainerWriterProjectionWireResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    ...writerProjectionResponseRuntimeRefinements,
    knownManifestsHeaderRefinement,
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
  headers: KnownManifestsHeadersSchema,
  params: DocumentWriterProjectionPathParamsSchema,
  path: "/documents/{documentId}/writer-projection",
  responses: {
    200: DocumentWriterProjectionWireResponseSchema,
    202: PrincipalHistoryPreparationResponseSchema,
  },
  runtimeRefinements: [
    ...writerProjectionResponseRuntimeRefinements,
    knownManifestsHeaderRefinement,
  ],
});

export const isGetContainerWriterProjectionOperationResponse =
  isContainerWriterProjectionWireResponse;
export const isGetDocumentWriterProjectionOperationResponse =
  isDocumentWriterProjectionWireResponse;
