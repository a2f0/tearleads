import { isOrganizationContainerGrantsResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function listOrganizationContainerGrants(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/grants`,
    isOrganizationContainerGrantsResponse,
    "GET",
  );
}
