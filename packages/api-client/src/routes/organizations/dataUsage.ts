import { isOrganizationDataUsageResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getOrganizationDataUsage(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/data-usage`,
    isOrganizationDataUsageResponse,
    "GET",
  );
}
