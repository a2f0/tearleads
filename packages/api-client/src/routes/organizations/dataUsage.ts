import {
  getOrganizationDataUsageOperation,
  isGetOrganizationDataUsageOperationResponse,
  operationRequestPath,
} from "@symcrypt/validators/operation";

export const getOrganizationDataUsage = {
  isResponse: isGetOrganizationDataUsageOperationResponse,
  method: getOrganizationDataUsageOperation.method,
  path(organizationId: string) {
    return operationRequestPath(getOrganizationDataUsageOperation, {
      organizationId,
    });
  },
};
