import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import { isCreateOrganizationGroupResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function createOrganizationGroup(
  request: RequestFn,
  organizationId: string,
  input: CreateOrganizationGroupRequest,
) {
  return request(
    `/organizations/${organizationId}/groups`,
    isCreateOrganizationGroupResponse,
    "POST",
    JSON.stringify(input),
  );
}
