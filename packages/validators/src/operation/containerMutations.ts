import { z } from "zod";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  ContainerCreateWithMetadataDocumentRequestSchema,
  ContainerMutationRequestSchema,
  isContainerCreateWithMetadataDocumentRequest,
  isContainerMutationRequest,
} from "../request";
import {
  ContainerCreateWithMetadataDocumentResponseSchema,
  ContainerDeleteResponseSchema,
  ContainerMutationResponseSchema,
  ErrorResponseSchema,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  PaymentRequiredErrorResponseSchema,
} from "../response";
import { defineJsonOperation } from "./definition";

const EmptyContainerMutationPathParamsSchema = z.strictObject({});

export const ContainerMutationPathParamsSchema = z.strictObject({
  containerId: z.string(),
});

export type ContainerMutationPathParams = z.infer<
  typeof ContainerMutationPathParamsSchema
>;

const containerMutationFailureResponses = {
  400: ErrorResponseSchema,
  401: ErrorResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ErrorResponseSchema,
  500: ErrorResponseSchema,
} as const;

const containerMutationFailureStatuses = [
  400, 401, 402, 403, 404, 409, 500,
] as const;

const containerMutationRuntimeRefinements = [
  organizationProvisioningContainerKeyringRefinement,
] as const;

export const createContainerOperation = defineJsonOperation({
  auth: "session",
  body: ContainerMutationRequestSchema,
  failureResponses: containerMutationFailureResponses,
  failureStatuses: containerMutationFailureStatuses,
  id: "containers.create",
  method: "POST",
  params: EmptyContainerMutationPathParamsSchema,
  path: "/containers",
  responses: { 200: ContainerMutationResponseSchema },
  runtimeRefinements: containerMutationRuntimeRefinements,
});

export const createContainerWithMetadataDocumentOperation = defineJsonOperation(
  {
    auth: "session",
    body: ContainerCreateWithMetadataDocumentRequestSchema,
    failureResponses: {
      ...containerMutationFailureResponses,
      503: ErrorResponseSchema,
    },
    failureStatuses: [...containerMutationFailureStatuses, 503],
    id: "containers.withMetadataDocument.create",
    method: "POST",
    params: EmptyContainerMutationPathParamsSchema,
    path: "/containers/with-metadata-document",
    responses: { 200: ContainerCreateWithMetadataDocumentResponseSchema },
    runtimeRefinements: containerMutationRuntimeRefinements,
  },
);

function defineContainerMutationOperation<
  const Id extends string,
  const Path extends `/${string}`,
>(input: { readonly id: Id; readonly path: Path }) {
  return defineJsonOperation({
    auth: "session",
    body: ContainerMutationRequestSchema,
    failureResponses: containerMutationFailureResponses,
    failureStatuses: containerMutationFailureStatuses,
    id: input.id,
    method: "POST",
    params: ContainerMutationPathParamsSchema,
    path: input.path,
    responses: { 200: ContainerMutationResponseSchema },
    runtimeRefinements: containerMutationRuntimeRefinements,
  });
}

export const shareContainerOperation = defineContainerMutationOperation({
  id: "containers.share",
  path: "/containers/{containerId}/share",
});

export const revokeContainerOperation = defineContainerMutationOperation({
  id: "containers.revoke",
  path: "/containers/{containerId}/revoke",
});

export const rekeyContainerOperation = defineContainerMutationOperation({
  id: "containers.rekey",
  path: "/containers/{containerId}/rekey",
});

export const moveContainerOperation = defineContainerMutationOperation({
  id: "containers.move",
  path: "/containers/{containerId}/move",
});

export const deleteContainerOperation = defineJsonOperation({
  auth: "session",
  failureResponses: containerMutationFailureResponses,
  failureStatuses: containerMutationFailureStatuses,
  id: "containers.delete",
  method: "DELETE",
  params: ContainerMutationPathParamsSchema,
  path: "/containers/{containerId}",
  responses: { 200: ContainerDeleteResponseSchema },
});

export const isContainerMutationOperationRequest = isContainerMutationRequest;
export const isContainerMutationOperationResponse = isContainerMutationResponse;
export const isCreateContainerWithMetadataDocumentOperationRequest =
  isContainerCreateWithMetadataDocumentRequest;
export const isCreateContainerWithMetadataDocumentOperationResponse =
  isContainerCreateWithMetadataDocumentResponse;
export const isDeleteContainerOperationResponse = isContainerDeleteResponse;
