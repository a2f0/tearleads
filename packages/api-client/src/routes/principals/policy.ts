import {
  commitOrganizationGroupPolicyOperation,
  getPrincipalMemberEnvelopesOperation,
  getPrincipalPolicyOperation,
  isCommitOrganizationGroupPolicyOperationRequest,
  isCommitOrganizationGroupPolicyOperationResponse,
  isGetPrincipalMemberEnvelopesOperationResponse,
  isGetPrincipalPolicyOperationResponse,
  isPutPrincipalPolicyOperationRequest,
  isPutPrincipalPolicyOperationResponse,
  operationRequestPath,
  operationRequestPathWithQuery,
  type PrincipalPolicyPageQuery,
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
  path(
    principalType: "group" | "organization",
    principalId: string,
    query: PrincipalPolicyPageQuery = {},
  ) {
    return operationRequestPathWithQuery(
      getPrincipalPolicyOperation,
      {
        principalId,
        principalType,
      },
      query,
    );
  },
};

export const getPrincipalMemberEnvelopes = {
  isResponse: isGetPrincipalMemberEnvelopesOperationResponse,
  method: getPrincipalMemberEnvelopesOperation.method,
  path(
    principalType: "group" | "organization",
    principalId: string,
    stateHash: string,
  ) {
    return operationRequestPathWithQuery(
      getPrincipalMemberEnvelopesOperation,
      { principalId, principalType },
      { stateHash },
    );
  },
};

export const putPrincipalPolicy = {
  isRequest: isPutPrincipalPolicyOperationRequest,
  isResponse: isPutPrincipalPolicyOperationResponse,
  method: putPrincipalPolicyOperation.method,
  path(principalType: "organization", principalId: string) {
    return operationRequestPath(putPrincipalPolicyOperation, {
      principalId,
      principalType,
    });
  },
};
