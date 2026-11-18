import {
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  isContainerMutationOperationRequest,
  isContainerMutationOperationResponse,
  isContainerRotationOperationRequest,
  isContainerRotationOperationResponse,
  isCreateContainerWithMetadataDocumentOperationRequest,
  isCreateContainerWithMetadataDocumentOperationResponse,
  isDeleteContainerOperationResponse,
  isShareContainerOperationResponse,
  moveContainerOperation,
  operationRequestPath,
  operationRequestPathWithQuery,
  reciteContainerOperation,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "@tearleads/validators/operation";
import { isContainerReciteRequest } from "@tearleads/validators/request";
import { isContainerReciteResponse } from "@tearleads/validators/response";

export const containerRecite = {
  isRequest: isContainerReciteRequest,
  isResponse: isContainerReciteResponse,
  method: reciteContainerOperation.method,
  path: (containerId: string) =>
    operationRequestPath(reciteContainerOperation, { containerId }),
} as const;

export const containerCreate = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isContainerMutationOperationResponse,
  method: createContainerOperation.method,
  path: operationRequestPath(createContainerOperation, {}),
} as const;

export const containerCreateWithMetadataDocument = {
  isRequest: isCreateContainerWithMetadataDocumentOperationRequest,
  isResponse: isCreateContainerWithMetadataDocumentOperationResponse,
  method: createContainerWithMetadataDocumentOperation.method,
  path: operationRequestPath(createContainerWithMetadataDocumentOperation, {}),
} as const;

function containerMutationPath(
  operation:
    | typeof moveContainerOperation
    | typeof rekeyContainerOperation
    | typeof revokeContainerOperation,
  containerId: string,
) {
  return operationRequestPath(operation, { containerId });
}

export const containerShare = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isShareContainerOperationResponse,
  method: shareContainerOperation.method,
  path: (containerId: string, readModelCursor?: string) =>
    operationRequestPathWithQuery(
      shareContainerOperation,
      { containerId },
      { readModelCursor },
    ),
} as const;

export const containerRevoke = {
  isRequest: isContainerRotationOperationRequest,
  isResponse: isContainerRotationOperationResponse,
  method: revokeContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(revokeContainerOperation, containerId),
} as const;

export const containerRekey = {
  isRequest: isContainerRotationOperationRequest,
  isResponse: isContainerRotationOperationResponse,
  method: rekeyContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(rekeyContainerOperation, containerId),
} as const;

export const containerMove = {
  isRequest: isContainerRotationOperationRequest,
  isResponse: isContainerRotationOperationResponse,
  method: moveContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(moveContainerOperation, containerId),
} as const;

export const containerDelete = {
  isResponse: isDeleteContainerOperationResponse,
  method: deleteContainerOperation.method,
  path: (containerId: string, requiredAncestorId?: string) =>
    operationRequestPathWithQuery(
      deleteContainerOperation,
      { containerId },
      { requiredAncestorId },
    ),
} as const;
