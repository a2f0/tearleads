import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import {
  isCreateOrganizationGroupResponse,
  isListOrganizationGroupsResponse,
  isOrganizationDirectoryResponse,
  isOrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
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

export function listOrganizationGroups(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${organizationId}/groups`,
    isListOrganizationGroupsResponse,
    "GET",
  );
}

export function createOrganizationGroup(
  request: RequestFn,
  organizationId: string,
  input: CreateOrganizationGroupRequest,
) {
  return request(
    `/organizations/${organizationId}/groups`,
    isCreateOrganizationGroupResponse,
    "POST",
    JSON.stringify(input),
  );
}

export function listOrganizationGroupMembers(
  request: RequestFn,
  organizationId: string,
  groupId: string,
) {
  return request(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    isOrganizationGroupMembersResponse,
    "GET",
  );
}
