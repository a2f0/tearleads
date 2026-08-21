import {
  deleteOrganizationGroupOperation,
  isDeleteOrganizationGroupOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const deleteOrganizationGroup = {
  isResponse: isDeleteOrganizationGroupOperationResponse,
  method: deleteOrganizationGroupOperation.method,
  path(organizationId: string, groupId: string) {
    return operationRequestPath(deleteOrganizationGroupOperation, {
      groupId,
      organizationId,
    });
  },
};
