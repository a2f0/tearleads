import {
  isListDocumentAttachmentsOperationResponse,
  listDocumentAttachmentsOperation,
  operationRequestPath,
} from "@tearleads/validators/operation";

export const listDocumentAttachments = {
  isResponse: isListDocumentAttachmentsOperationResponse,
  method: listDocumentAttachmentsOperation.method,
  path(documentId: string) {
    return operationRequestPath(listDocumentAttachmentsOperation, {
      documentId,
    });
  },
};
