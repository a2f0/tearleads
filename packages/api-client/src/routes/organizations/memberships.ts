import {
  isListOrganizationMembershipsOperationResponse,
  isUpdateOrganizationMembershipOperationRequest,
  isUpdateOrganizationMembershipOperationResponse,
  listOrganizationMembershipsOperation,
  operationRequestPath,
  updateOrganizationMembershipOperation,
} from "@tearleads/validators/operation";

export const listOrganizationMemberships = {
  isResponse: isListOrganizationMembershipsOperationResponse,
  method: listOrganizationMembershipsOperation.method,
  path: operationRequestPath(listOrganizationMembershipsOperation, {}),
};

export const updateOrganizationMembership = {
  isRequest: isUpdateOrganizationMembershipOperationRequest,
  isResponse: isUpdateOrganizationMembershipOperationResponse,
  method: updateOrganizationMembershipOperation.method,
  path(organizationId: string) {
    return operationRequestPath(updateOrganizationMembershipOperation, {
      organizationId,
    });
  },
};
