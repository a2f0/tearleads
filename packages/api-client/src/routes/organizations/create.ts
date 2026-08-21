import {
  createOrganizationOperation,
  isCreateOrganizationOperationRequest,
  isCreateOrganizationOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const createOrganization = {
  isRequest: isCreateOrganizationOperationRequest,
  isResponse: isCreateOrganizationOperationResponse,
  method: createOrganizationOperation.method,
  path: operationRequestPath(createOrganizationOperation, {}),
};
