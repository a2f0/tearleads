import {
  isListOrganizationMembershipsOperationResponse,
  isRequestOrganizationLeaveOperationRequest,
  isUpdateOrganizationMembershipOperationRequest,
  isUpdateOrganizationMembershipOperationResponse,
  listOrganizationMembershipsOperation,
  operationRequestPath,
  requestOrganizationLeaveOperation,
  updateOrganizationMembershipOperation,
  withdrawOrganizationLeaveRequestOperation,
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

export const requestOrganizationLeave = {
  isRequest: isRequestOrganizationLeaveOperationRequest,
  isResponse: isUpdateOrganizationMembershipOperationResponse,
  method: requestOrganizationLeaveOperation.method,
  path(organizationId: string) {
    return operationRequestPath(requestOrganizationLeaveOperation, {
      organizationId,
    });
  },
};

export const withdrawOrganizationLeaveRequest = {
  isResponse: isUpdateOrganizationMembershipOperationResponse,
  method: withdrawOrganizationLeaveRequestOperation.method,
  path(organizationId: string) {
    return operationRequestPath(withdrawOrganizationLeaveRequestOperation, {
      organizationId,
    });
  },
};
