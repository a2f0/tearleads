import {
  createOrganizationGroupOperation,
  isCreateOrganizationGroupOperationRequest,
  isCreateOrganizationGroupOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const createOrganizationGroup = {
  isRequest: isCreateOrganizationGroupOperationRequest,
  isResponse: isCreateOrganizationGroupOperationResponse,
  method: createOrganizationGroupOperation.method,
  path(organizationId: string) {
    return operationRequestPath(createOrganizationGroupOperation, {
      organizationId,
    });
  },
};
