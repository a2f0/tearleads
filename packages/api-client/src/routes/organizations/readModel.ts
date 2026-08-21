import {
  getOrganizationReadModelOperation,
  isGetOrganizationReadModelOperationResponse,
  operationRequestPathWithQuery,
} from "@symcrypt/validators/operation";

export const getOrganizationReadModel = {
  isResponse: isGetOrganizationReadModelOperationResponse,
  method: getOrganizationReadModelOperation.method,
  path(organizationId: string, cursor: string | undefined) {
    return operationRequestPathWithQuery(
      getOrganizationReadModelOperation,
      { organizationId },
      { cursor },
    );
  },
};
