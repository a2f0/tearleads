import {
  challengeOperation,
  isChallengeOperationResponse,
  isVerifyOperationResponse,
  operationRequestPath,
  verifyOperation,
} from "@symcrypt/validators/operation";

export const challenge = {
  isResponse: isChallengeOperationResponse,
  method: challengeOperation.method,
  path: operationRequestPath(challengeOperation, {}),
};

export const verify = {
  isResponse: isVerifyOperationResponse,
  method: verifyOperation.method,
  path: operationRequestPath(verifyOperation, {}),
};
