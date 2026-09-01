import {
  createOrganizationOperation,
  isCreateOrganizationOperationRequest,
  isCreateOrganizationOperationResponse,
  operationRequestPath,
} from "@tearleads/validators/operation";

export const createOrganization = {
  isRequest: isCreateOrganizationOperationRequest,
  isResponse: isCreateOrganizationOperationResponse,
  method: createOrganizationOperation.method,
  path: operationRequestPath(createOrganizationOperation, {}),
};
