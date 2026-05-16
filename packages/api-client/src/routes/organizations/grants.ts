import { isOrganizationContainerGrantsResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function listOrganizationContainerGrants(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${organizationId}/grants`,
    isOrganizationContainerGrantsResponse,
    "GET",
  );
}
