import {
  createDocumentOperation,
  deleteDocumentOperation,
  isCreateDocumentOperationRequest,
  isCreateDocumentOperationResponse,
  isDeleteDocumentOperationResponse,
  isDocumentLinkSetMutationOperationRequest,
  isDocumentLinkSetMutationOperationResponse,
  linkDocumentOperation,
  operationRequestPath,
  unlinkDocumentOperation,
} from "@tearleads/validators/operation";

export const documentCreate = {
  isRequest: isCreateDocumentOperationRequest,
  isResponse: isCreateDocumentOperationResponse,
  method: createDocumentOperation.method,
  path: operationRequestPath(createDocumentOperation, {}),
} as const;

function documentLinkSetMutationPath(
  operation: typeof linkDocumentOperation | typeof unlinkDocumentOperation,
  documentId: string,
) {
  return operationRequestPath(operation, { documentId });
}

export const documentLink = {
  isRequest: isDocumentLinkSetMutationOperationRequest,
  isResponse: isDocumentLinkSetMutationOperationResponse,
  method: linkDocumentOperation.method,
  path: (documentId: string) =>
    documentLinkSetMutationPath(linkDocumentOperation, documentId),
} as const;

export const documentUnlink = {
  isRequest: isDocumentLinkSetMutationOperationRequest,
  isResponse: isDocumentLinkSetMutationOperationResponse,
  method: unlinkDocumentOperation.method,
  path: (documentId: string) =>
    documentLinkSetMutationPath(unlinkDocumentOperation, documentId),
} as const;

export const documentDelete = {
  isResponse: isDeleteDocumentOperationResponse,
  method: deleteDocumentOperation.method,
  path: (documentId: string) =>
    operationRequestPath(deleteDocumentOperation, { documentId }),
} as const;
