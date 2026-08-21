import {
  isUpdateOrganizationProfileOperationRequest,
  isUpdateOrganizationProfileOperationResponse,
  operationRequestPath,
  updateOrganizationProfileOperation,
} from "@symcrypt/validators/operation";

export const updateOrganizationProfile = {
  isRequest: isUpdateOrganizationProfileOperationRequest,
  isResponse: isUpdateOrganizationProfileOperationResponse,
  method: updateOrganizationProfileOperation.method,
  path(organizationId: string) {
    return operationRequestPath(updateOrganizationProfileOperation, {
      organizationId,
    });
  },
};
