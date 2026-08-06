import {
  getHealthOperation,
  isGetHealthOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";

export const getHealth = {
  isResponse: isGetHealthOperationResponse,
  method: getHealthOperation.method,
  path: operationRequestPath(getHealthOperation, {}),
};
