import { isOrganizationUserDetailResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function getOrganizationUserDetail(
  request: RequestFn,
  organizationId: string,
  userId: string,
) {
  return request(
    `/organizations/${organizationId}/users/${userId}/detail`,
    isOrganizationUserDetailResponse,
    "GET",
  );
}
