import {
  isListOrganizationGroupsResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";

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

export function listOrganizationGroupContainers(
  request: RequestFn,
  organizationId: string,
  groupId: string,
) {
  return request(
    `/organizations/${organizationId}/groups/${groupId}/containers`,
    isOrganizationGroupContainersResponse,
    "GET",
  );
}
