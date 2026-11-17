import {
  createOrganizationGroupOperation,
  isCreateOrganizationGroupOperationRequest,
  isCreateOrganizationGroupOperationResponse,
  operationRequestPathWithQuery,
} from "@tearleads/validators/operation";

export const createOrganizationGroup = {
  isRequest: isCreateOrganizationGroupOperationRequest,
  isResponse: isCreateOrganizationGroupOperationResponse,
  method: createOrganizationGroupOperation.method,
  path(organizationId: string, readModelCursor?: string) {
    return operationRequestPathWithQuery(
      createOrganizationGroupOperation,
      { organizationId },
      { readModelCursor },
    );
  },
};
