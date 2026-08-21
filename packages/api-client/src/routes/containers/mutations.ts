import {
  createContainerOperation,
  createContainerWithMetadataDocumentOperation,
  deleteContainerOperation,
  isContainerMutationOperationRequest,
  isContainerMutationOperationResponse,
  isCreateContainerWithMetadataDocumentOperationRequest,
  isCreateContainerWithMetadataDocumentOperationResponse,
  isDeleteContainerOperationResponse,
  moveContainerOperation,
  operationRequestPath,
  rekeyContainerOperation,
  revokeContainerOperation,
  shareContainerOperation,
} from "@symcrypt/validators/operation";

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
    | typeof revokeContainerOperation
    | typeof shareContainerOperation,
  containerId: string,
) {
  return operationRequestPath(operation, { containerId });
}

export const containerShare = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isContainerMutationOperationResponse,
  method: shareContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(shareContainerOperation, containerId),
} as const;

export const containerRevoke = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isContainerMutationOperationResponse,
  method: revokeContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(revokeContainerOperation, containerId),
} as const;

export const containerRekey = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isContainerMutationOperationResponse,
  method: rekeyContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(rekeyContainerOperation, containerId),
} as const;

export const containerMove = {
  isRequest: isContainerMutationOperationRequest,
  isResponse: isContainerMutationOperationResponse,
  method: moveContainerOperation.method,
  path: (containerId: string) =>
    containerMutationPath(moveContainerOperation, containerId),
} as const;

export const containerDelete = {
  isResponse: isDeleteContainerOperationResponse,
  method: deleteContainerOperation.method,
  path: (containerId: string) =>
    operationRequestPath(deleteContainerOperation, { containerId }),
} as const;
