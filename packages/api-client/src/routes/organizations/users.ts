import { isOrganizationUserDetailResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function getOrganizationUserDetail(
  request: RequestFn,
  organizationId: string,
  userId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/users/${pathSegment(userId)}/detail`,
    isOrganizationUserDetailResponse,
    "GET",
  );
}
