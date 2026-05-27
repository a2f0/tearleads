import {
  isListOrganizationGroupsResponse,
  isOrganizationGroupContainersResponse,
  isOrganizationGroupMembersResponse,
} from "@tearleads/validators/response";
import type { RequestFn } from "../../types";
import { pathSegment } from "../path";

export function listOrganizationGroups(
  request: RequestFn,
  organizationId: string,
) {
  return request(
    `/organizations/${pathSegment(organizationId)}/groups`,
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
    `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}/members`,
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
    `/organizations/${pathSegment(organizationId)}/groups/${pathSegment(groupId)}/containers`,
    isOrganizationGroupContainersResponse,
    "GET",
  );
}
