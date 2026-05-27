import type { UpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
import { isOrganizationDirectoryUserResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function updateOrganizationRosterEntry(
  request: RequestFn,
  organizationId: string,
  userId: string,
  input: UpdateOrganizationRosterEntryRequest,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/roster/${pathSegment(userId)}`,
    isOrganizationDirectoryUserResponse,
    "PUT",
    JSON.stringify(input),
  );
}
