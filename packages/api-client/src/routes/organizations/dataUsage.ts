import { isOrganizationDataUsageResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getOrganizationDataUsage(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${organizationId}/data-usage`,
    isOrganizationDataUsageResponse,
    "GET",
  );
}
