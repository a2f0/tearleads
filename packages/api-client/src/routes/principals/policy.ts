import {
  commitOrganizationGroupPolicyOperation,
  getPrincipalPolicyOperation,
  isCommitOrganizationGroupPolicyOperationRequest,
  isCommitOrganizationGroupPolicyOperationResponse,
  isGetPrincipalPolicyOperationResponse,
  isPutPrincipalPolicyOperationRequest,
  isPutPrincipalPolicyOperationResponse,
  operationRequestPath,
  putPrincipalPolicyOperation,
} from "@tearleads/validators/operation";

export const commitOrganizationGroupPolicy = {
  isRequest: isCommitOrganizationGroupPolicyOperationRequest,
  isResponse: isCommitOrganizationGroupPolicyOperationResponse,
  method: commitOrganizationGroupPolicyOperation.method,
  path(organizationId: string, groupId: string) {
    return operationRequestPath(commitOrganizationGroupPolicyOperation, {
      groupId,
      organizationId,
    });
  },
};

export const getPrincipalPolicy = {
  isResponse: isGetPrincipalPolicyOperationResponse,
  method: getPrincipalPolicyOperation.method,
  path(principalType: "group" | "organization", principalId: string) {
    return operationRequestPath(getPrincipalPolicyOperation, {
      principalId,
      principalType,
    });
  },
};

export const putPrincipalPolicy = {
  isRequest: isPutPrincipalPolicyOperationRequest,
  isResponse: isPutPrincipalPolicyOperationResponse,
  method: putPrincipalPolicyOperation.method,
  path(principalType: "group" | "organization", principalId: string) {
    return operationRequestPath(putPrincipalPolicyOperation, {
      principalId,
      principalType,
    });
  },
};
