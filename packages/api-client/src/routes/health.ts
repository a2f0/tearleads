import {
  getHealthOperation,
  isGetHealthOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const getHealth = {
  isResponse: isGetHealthOperationResponse,
  method: getHealthOperation.method,
  path: operationRequestPath(getHealthOperation, {}),
};
