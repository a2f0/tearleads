import {
  bindBlobAttachmentOperation,
  detachBlobAttachmentOperation,
  isBindBlobAttachmentOperationRequest,
  isBindBlobAttachmentOperationResponse,
  isDetachBlobAttachmentOperationRequest,
  isDetachBlobAttachmentOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";

export const bindBlobAttachment = {
  isRequest: isBindBlobAttachmentOperationRequest,
  isResponse: isBindBlobAttachmentOperationResponse,
  method: bindBlobAttachmentOperation.method,
  path(blobId: string) {
    return operationRequestPath(bindBlobAttachmentOperation, { blobId });
  },
};

export const detachBlobAttachment = {
  isRequest: isDetachBlobAttachmentOperationRequest,
  isResponse: isDetachBlobAttachmentOperationResponse,
  method: detachBlobAttachmentOperation.method,
  path(blobId: string, bindingId: string) {
    return operationRequestPath(detachBlobAttachmentOperation, {
      bindingId,
      blobId,
    });
  },
};
