import {
  completeMultipartBlobStageOperation,
  getMultipartBlobStageOperation,
  initiateMultipartBlobStageOperation,
  isCompleteMultipartBlobStageOperationRequest,
  isCompleteMultipartBlobStageOperationResponse,
  isGetMultipartBlobStageOperationResponse,
  isInitiateMultipartBlobStageOperationRequest,
  isInitiateMultipartBlobStageOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";

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
