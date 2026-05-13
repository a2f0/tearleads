import { isOrganizationDirectoryResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

export function listOrganizationDirectory(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${organizationId}/directory`,
    isOrganizationDirectoryResponse,
    "GET",
  );
}
