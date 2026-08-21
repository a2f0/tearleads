import {
  blobWireHeaderNames,
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  isCompleteMultipartBlobStageOperationRequest,
  isCompleteMultipartBlobStageOperationResponse,
  isGetMultipartBlobStageOperationResponse,
  isInitiateMultipartBlobStageOperationRequest,
  isInitiateMultipartBlobStageOperationResponse,
  isUploadMultipartBlobPartBytesOperationResponse,
  operationRequestPath,
  uploadMultipartBlobPartBytesOperation,
} from "@symcrypt/validators/operation";

export const initiateMultipartBlobStage = {
  isRequest: isInitiateMultipartBlobStageOperationRequest,
  isResponse: isInitiateMultipartBlobStageOperationResponse,
  method: initiateMultipartBlobStageOperation.method,
  path: operationRequestPath(initiateMultipartBlobStageOperation, {}),
};

export const getMultipartBlobStage = {
  isResponse: isGetMultipartBlobStageOperationResponse,
  method: getMultipartBlobStageOperation.method,
  path(stageId: string) {
    return operationRequestPath(getMultipartBlobStageOperation, { stageId });
  },
};

export const completeMultipartBlobStage = {
  isRequest: isCompleteMultipartBlobStageOperationRequest,
  isResponse: isCompleteMultipartBlobStageOperationResponse,
  method: completeMultipartBlobStageOperation.method,
  path(stageId: string) {
    return operationRequestPath(completeMultipartBlobStageOperation, {
      stageId,
    });
  },
};

export const uploadMultipartBlobPartBytes = {
  headerNames: {
    byteLength: blobWireHeaderNames.partByteLength,
    sha256: blobWireHeaderNames.partSha256,
    uploadId: blobWireHeaderNames.partUploadId,
  },
  isResponse: isUploadMultipartBlobPartBytesOperationResponse,
  method: uploadMultipartBlobPartBytesOperation.method,
  path(stageId: string, partNumber: number) {
    return operationRequestPath(uploadMultipartBlobPartBytesOperation, {
      partNumber,
      stageId,
    });
  },
  requestHeaders: uploadMultipartBlobPartBytesOperation.headers,
};
