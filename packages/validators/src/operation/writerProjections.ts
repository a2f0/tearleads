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
  summary: "Get a container writer projection",
  description:
    "Returns everything a client needs to read and write under a container: the signed manifests on its authorizing container path, each path level's container KEK wraps and keyring, and the key targets. Requires current read access; write authority is checked again when a write commits. A 202 asks the client to retry the identical request after the server prepares policy history, and the `x-known-manifests` header lets a client skip manifests it already holds.",
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
  summary: "Get a document writer projection",
  description:
    "Returns everything a client needs to read and write a document: its document link-set manifest history, the authorizing container paths with their KEK wraps and keyrings, and the key targets. Requires current read access; write authority is checked again when a write commits. A vanished container is reported as 409, never 404, because 404 here means the document itself was deleted.",
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
