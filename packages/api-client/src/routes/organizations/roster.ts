import type { UpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
import { isOrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function updateOrganizationRosterEntry(
  request: RequestFn,
  organizationId: string,
  userId: string,
  input: UpdateOrganizationRosterEntryRequest,
) {
  return request(
    `/organizations/${organizationId}/roster/${userId}`,
    isOrganizationDirectoryUserResponse,
    "PUT",
    JSON.stringify(input),
  );
}
