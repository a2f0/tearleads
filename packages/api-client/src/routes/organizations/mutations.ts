import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import {
  isCreateOrganizationGroupResponse,
  isDeleteOrganizationGroupResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function createOrganizationGroup(
  request: RequestFn,
  organizationId: string,
  input: CreateOrganizationGroupRequest,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/groups`,
    isCreateOrganizationGroupResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function deleteOrganizationGroup(
  request: RequestFn,
  organizationId: string,
  groupId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}`,
    isDeleteOrganizationGroupResponse,
    "DELETE",
  );
}
