import {
  isRegistrationOperationRequest,
  isRegistrationOperationResponse,
  operationRequestPath,
  registerOperation,
} from "@symcrypt/validators/operation";

export const register = {
  isRequest: isRegistrationOperationRequest,
  isResponse: isRegistrationOperationResponse,
  method: registerOperation.method,
  path: operationRequestPath(registerOperation, {}),
};
