import { z } from "zod";
import { containerCreateMetadataSeedRefinement } from "../documentCreateSeedRefinements";
import { documentSyncRequestRuntimeRefinements } from "../documentSyncRefinements";
import { organizationProvisioningContainerKeyringRefinement } from "../organizationProvisioningRefinements";
import {
  ContainerCreateWithMetadataDocumentRequestSchema,
  ContainerMutationRequestSchema,
  ContainerReciteRequestSchema,
  ContainerRotationRequestSchema,
  isContainerCreateWithMetadataDocumentRequest,
  isContainerMutationRequest,
  isContainerRotationRequest,
} from "../request";
import {
  ContainerCreateWithMetadataDocumentResponseSchema,
  ContainerDeleteResponseSchema,
  ContainerMutationFailureResponseSchema,
  ContainerMutationResponseSchema,
  ContainerNotFoundErrorResponseSchema,
  ContainerReciteResponseSchema,
  ContainerRotationResponseSchema,
  ErrorResponseSchema,
  isContainerCreateWithMetadataDocumentResponse,
  isContainerDeleteResponse,
  isContainerMutationResponse,
  isContainerRotationResponse,
  PaymentRequiredErrorResponseSchema,
  SessionFailureResponseSchema,
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
  401: SessionFailureResponseSchema,
  402: PaymentRequiredErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  409: ContainerMutationFailureResponseSchema,
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
  summary: "Create a container",
  description:
    "Creates a container from a signed `container.create` event, its derived access manifest, and the container KEK wrapped to its recipients. Requires write access to the parent container, or admin access for a system container. A retry of a create that already committed returns 409 `container_manifest_already_exists`, which lets the client adopt it; a stale parent returns 409 `container_mutation_state_stale`.",
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
    summary: "Create a container with its metadata document",
    description:
      "Creates a container and its encrypted metadata document in one transaction, optionally seeding the document's first update. Authorization and conflicts are those of `POST /containers` and `POST /documents`; a 409 `document_manifest_already_exists` may have rolled the new container back, so clients treat it as terminal unless they verify both artifacts.",
    method: "POST",
    params: EmptyContainerMutationPathParamsSchema,
    path: "/containers/with-metadata-document",
    responses: { 200: ContainerCreateWithMetadataDocumentResponseSchema },
    runtimeRefinements: [
      ...containerMutationRuntimeRefinements,
      containerCreateMetadataSeedRefinement,
      ...documentSyncRequestRuntimeRefinements,
    ],
  },
);

function defineContainerMutationOperation<
  const Id extends string,
  const Path extends `/${string}`,
>(input: {
  readonly id: Id;
  readonly path: Path;
  readonly summary: string;
  readonly description: string;
}) {
  return defineJsonOperation({
    auth: "session",
    body: ContainerMutationRequestSchema,
    failureResponses: containerMutationFailureResponses,
    failureStatuses: containerMutationFailureStatuses,
    id: input.id,
    summary: input.summary,
    description: input.description,
    method: "POST",
    params: ContainerMutationPathParamsSchema,
    path: input.path,
    responses: { 200: ContainerMutationResponseSchema },
    runtimeRefinements: containerMutationRuntimeRefinements,
  });
}

/**
 * Rekey, revoke, and move mint a new key epoch, so they alone may carry the
 * descendant rekeys that must commit with them.
 */
function defineContainerRotationOperation<
  const Id extends string,
  const Path extends `/${string}`,
>(input: {
  readonly id: Id;
  readonly path: Path;
  readonly summary: string;
  readonly description: string;
}) {
  return defineJsonOperation({
    auth: "session",
    body: ContainerRotationRequestSchema,
    failureResponses: containerMutationFailureResponses,
    failureStatuses: containerMutationFailureStatuses,
    id: input.id,
    summary: input.summary,
    description: input.description,
    method: "POST",
    params: ContainerMutationPathParamsSchema,
    path: input.path,
    responses: { 200: ContainerRotationResponseSchema },
    runtimeRefinements: containerMutationRuntimeRefinements,
  });
}

export const shareContainerOperation = defineContainerMutationOperation({
  id: "containers.share",
  summary: "Share a container",
  description:
    "Adds or changes a user or group grant on a container through a signed `container.grant` event, wrapping the current container KEK to the new recipients. Requires admin access through the container's path. Cited heads must be current: a stale container head returns 409 `container_mutation_state_stale`, and a stale principal policy returns 409 `principal_policy_stale` with the current heads.",
  path: "/containers/{containerId}/share",
});

export const reciteContainerOperation = defineJsonOperation({
  auth: "session",
  body: ContainerReciteRequestSchema,
  failureResponses: containerMutationFailureResponses,
  failureStatuses: containerMutationFailureStatuses,
  id: "containers.recite",
  summary: "Re-cite a held container's current ancestor path",
  description:
    "Advances a container's access manifest so it cites its ancestors' current heads, without changing grants, keys, or parent. Clients call it after changing an ancestor so descendants they already hold stop citing superseded heads. Requires admin access; after 512 epochs the container no longer accepts re-citations.",
  method: "POST",
  params: ContainerMutationPathParamsSchema,
  path: "/containers/{containerId}/recite",
  responses: { 200: ContainerReciteResponseSchema },
});

export const revokeContainerOperation = defineContainerRotationOperation({
  id: "containers.revoke",
  summary: "Revoke a container grant",
  description:
    "Removes a grant from a container through a signed `container.revoke` event and rotates the container KEK so the removed principal cannot read later content. The request carries the new KEK epoch, its predecessor bridge, and the re-sealed container KEK keyring. Requires admin access; stale cited heads return 409.",
  path: "/containers/{containerId}/revoke",
});

export const rekeyContainerOperation = defineContainerRotationOperation({
  id: "containers.rekey",
  summary: "Rekey a container",
  description:
    "Rotates a container's KEK to a new epoch without changing grants, carrying the predecessor bridge and the re-sealed container KEK keyring. Requires write access. Stale cited heads return 409, and epochs above 65536 are refused.",
  path: "/containers/{containerId}/rekey",
});

export const moveContainerOperation = defineContainerRotationOperation({
  id: "containers.move",
  summary: "Move a container",
  description:
    "Moves a container under a new parent through a signed `container.move` event and rotates its container KEK. Requires admin access at the source and write access at the destination; root and system containers cannot move. Moving into Trash is an ordinary move and can be undone.",
  path: "/containers/{containerId}/move",
});

export const deleteContainerOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    ...containerMutationFailureResponses,
    404: ContainerNotFoundErrorResponseSchema,
  },
  failureStatuses: containerMutationFailureStatuses,
  id: "containers.delete",
  summary: "Delete a container",
  description:
    "Deletes an empty folder: a container with no child containers and no linked user documents, along with its own metadata document. Requires admin access; root and system containers cannot be deleted. Peers learn of the deletion from a sync tombstone, and an unknown container returns 404 `container_not_found`.",
  method: "DELETE",
  params: ContainerMutationPathParamsSchema,
  path: "/containers/{containerId}",
  query: z.strictObject({ requiredAncestorId: z.string().min(1).optional() }),
  responses: { 200: ContainerDeleteResponseSchema },
});

export const isContainerMutationOperationRequest = isContainerMutationRequest;
export const isContainerMutationOperationResponse = isContainerMutationResponse;
export const isContainerRotationOperationRequest = isContainerRotationRequest;
export const isContainerRotationOperationResponse = isContainerRotationResponse;
export const isCreateContainerWithMetadataDocumentOperationRequest =
  isContainerCreateWithMetadataDocumentRequest;
export const isCreateContainerWithMetadataDocumentOperationResponse =
  isContainerCreateWithMetadataDocumentResponse;
export const isDeleteContainerOperationResponse = isContainerDeleteResponse;
