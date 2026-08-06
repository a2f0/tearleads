import {
  isRegistrationOperationRequest,
  isRegistrationOperationResponse,
  operationRequestPath,
  registerOperation,
} from "@tearleads/validators/operation";

export const register = {
  isRequest: isRegistrationOperationRequest,
  isResponse: isRegistrationOperationResponse,
  method: registerOperation.method,
  path: operationRequestPath(registerOperation, {}),
};
