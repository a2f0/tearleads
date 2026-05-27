import { isOrganizationDirectoryResponse } from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function listOrganizationDirectory(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/directory`,
    isOrganizationDirectoryResponse,
    "GET",
  );
}
