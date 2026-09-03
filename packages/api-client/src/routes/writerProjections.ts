import {
  getContainerWriterProjectionOperation,
  getDocumentWriterProjectionOperation,
  isGetContainerWriterProjectionOperationResponse,
  isGetDocumentWriterProjectionOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";
import type {
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";

// A writer projection is consumed by its leaf: callers wrap keys under
// whatever container or document the response describes. Binding the
// validator to the requested id makes a projection for any other object an
// invalid response, so a server cannot redirect a create, move, share, rekey,
// or content-key re-wrap onto an object it substituted.
export const containerWriterProjection = {
  isResponseFor(containerId: string) {
    return (value: unknown): value is ContainerWriterProjectionResponse =>
      isGetContainerWriterProjectionOperationResponse(value) &&
      value.containerId === containerId;
  },
  method: getContainerWriterProjectionOperation.method,
  path(containerId: string) {
    return operationRequestPath(getContainerWriterProjectionOperation, {
      containerId,
    });
  },
};

export const documentWriterProjection = {
  isResponseFor(documentId: string) {
    return (value: unknown): value is DocumentWriterProjectionResponse =>
      isGetDocumentWriterProjectionOperationResponse(value) &&
      value.documentId === documentId;
  },
  method: getDocumentWriterProjectionOperation.method,
  path(documentId: string) {
    return operationRequestPath(getDocumentWriterProjectionOperation, {
      documentId,
    });
  },
};
