import {
  documentSyncOperation,
  isDocumentSyncOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const documentSync = {
  isResponse: isDocumentSyncOperationResponse,
  method: documentSyncOperation.method,
  path(documentId: string) {
    return operationRequestPath(documentSyncOperation, { documentId });
  },
};
