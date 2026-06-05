import type { UpdateOrganizationProfileRequest } from "@tearleads/validators/request";
import { isOrganizationProfileResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function updateOrganizationProfile(
  request: RequestFn,
  organizationId: string,
  input: UpdateOrganizationProfileRequest,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/profile`,
    isOrganizationProfileResponse,
    "PUT",
    JSON.stringify(input),
  );
}
