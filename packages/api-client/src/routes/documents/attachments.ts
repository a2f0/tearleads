import {
  isListDocumentAttachmentsOperationResponse,
  listDocumentAttachmentsOperation,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const listDocumentAttachments = {
  isResponse: isListDocumentAttachmentsOperationResponse,
  method: listDocumentAttachmentsOperation.method,
  path(documentId: string) {
    return operationRequestPath(listDocumentAttachmentsOperation, {
      documentId,
    });
  },
};
