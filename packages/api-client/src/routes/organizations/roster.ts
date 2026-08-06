import {
  isUpdateOrganizationRosterEntryOperationRequest,
  isUpdateOrganizationRosterEntryOperationResponse,
  operationRequestPath,
  updateOrganizationRosterEntryOperation,
} from "@tearleads/validators/operation";

export const updateOrganizationRosterEntry = {
  isRequest: isUpdateOrganizationRosterEntryOperationRequest,
  isResponse: isUpdateOrganizationRosterEntryOperationResponse,
  method: updateOrganizationRosterEntryOperation.method,
  path(organizationId: string, userId: string) {
    return operationRequestPath(updateOrganizationRosterEntryOperation, {
      organizationId,
      userId,
    });
  },
};
