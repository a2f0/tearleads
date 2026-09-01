import {
  isListOrganizationGroupMembersOperationResponse,
  listOrganizationGroupMembersOperation,
  operationRequestPath,
} from "@tearleads/validators/operation";

export const listOrganizationGroupMembers = {
  isResponse: isListOrganizationGroupMembersOperationResponse,
  method: listOrganizationGroupMembersOperation.method,
  path(organizationId: string, groupId: string) {
    return operationRequestPath(listOrganizationGroupMembersOperation, {
      groupId,
      organizationId,
    });
  },
};
