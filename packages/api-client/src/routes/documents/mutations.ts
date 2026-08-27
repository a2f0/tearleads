import {
  createDocumentOperation,
  getDocumentPurgeProofOperation,
  isCreateDocumentOperationRequest,
  isCreateDocumentOperationResponse,
  isDocumentLinkSetMutationOperationRequest,
  isDocumentLinkSetMutationOperationResponse,
  isGetDocumentPurgeProofOperationResponse,
  isPurgeDocumentOperationRequest,
  isPurgeDocumentOperationResponse,
  linkDocumentOperation,
  operationRequestPath,
  operationRequestPathWithQuery,
  purgeDocumentOperation,
  unlinkDocumentOperation,
} from "@symcrypt/validators/operation";

export interface DocumentPurgeProofOptions {
  readonly documentCheckpointManifestHash?: string;
}

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

export const documentPurge = {
  isRequest: isPurgeDocumentOperationRequest,
  isResponse: isPurgeDocumentOperationResponse,
  method: purgeDocumentOperation.method,
  path: (documentId: string) =>
    operationRequestPath(purgeDocumentOperation, { documentId }),
} as const;

export const documentPurgeProof = {
  isResponse: isGetDocumentPurgeProofOperationResponse,
  method: getDocumentPurgeProofOperation.method,
  path: (documentId: string, options: DocumentPurgeProofOptions = {}) =>
    operationRequestPathWithQuery(
      getDocumentPurgeProofOperation,
      { documentId },
      {
        documentCheckpointManifestHash: options.documentCheckpointManifestHash,
      },
    ),
} as const;
