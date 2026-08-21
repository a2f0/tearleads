import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  isGetContainerWriterProjectionOperationResponse,
  isGetDocumentWriterProjectionOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const containerWriterProjection = {
  isResponse: isGetContainerWriterProjectionOperationResponse,
  method: getContainerWriterProjectionOperation.method,
  path(containerId: string) {
    return operationRequestPath(getContainerWriterProjectionOperation, {
      containerId,
    });
  },
};

export const documentWriterProjection = {
  isResponse: isGetDocumentWriterProjectionOperationResponse,
  method: getDocumentWriterProjectionOperation.method,
  path(documentId: string) {
    return operationRequestPath(getDocumentWriterProjectionOperation, {
      documentId,
    });
  },
};
