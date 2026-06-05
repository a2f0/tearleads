import type {
  CreateOrganizationGroupRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  DeleteOrganizationGroupResponse,
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDataUsageResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
  OrganizationUserDetailResponse,
} from "@tearleads/validators/response";
import {
  OrganizationManagerError,
  runCreateOrganizationGroupWorkflow,
  runDeleteOrganizationGroupWorkflow,
  runGetOrganizationDataUsageWorkflow,
  runGetOrganizationUserDetailWorkflow,
  runListOrganizationContainerGrantsWorkflow,
  runListOrganizationDirectoryWorkflow,
  runListOrganizationGroupContainersWorkflow,
  runListOrganizationGroupMembersWorkflow,
  runListOrganizationGroupsWorkflow,
  runUpdateOrganizationRosterEntryWorkflow,
} from "../../workflows/organizations";
import type { ApiServiceRuntime } from "../runtime";

export { OrganizationManagerError };

export async function listOrganizationDirectory(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDirectoryResponse> {
  return runListOrganizationDirectoryWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
}

export async function listOrganizationGroups(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<ListOrganizationGroupsResponse> {
  return runListOrganizationGroupsWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
}

export async function listOrganizationContainerGrants(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationContainerGrantsResponse> {
  return runListOrganizationContainerGrantsWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
}

export async function getOrganizationDataUsage(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationDataUsageResponse> {
  return runGetOrganizationDataUsageWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
}

export async function getOrganizationUserDetail(
  runtime: ApiServiceRuntime,
  organizationId: string,
  userId: string,
  sessionUserId: string,
): Promise<OrganizationUserDetailResponse> {
  return runGetOrganizationUserDetailWorkflow(
    runtime.db,
    organizationId,
    userId,
    sessionUserId,
  );
}

export async function updateOrganizationRosterEntry(
  runtime: ApiServiceRuntime,
  organizationId: string,
  userId: string,
  sessionUserId: string,
  input: UpdateOrganizationRosterEntryRequest,
): Promise<OrganizationDirectoryUserResponse> {
  return runUpdateOrganizationRosterEntryWorkflow(
    runtime.db,
    organizationId,
    userId,
    sessionUserId,
    input,
  );
}

export async function createOrganizationGroup(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  input: CreateOrganizationGroupRequest,
): Promise<OrganizationGroupSummaryResponse> {
  return runCreateOrganizationGroupWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    input,
  );
}

export async function deleteOrganizationGroup(
  runtime: ApiServiceRuntime,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<DeleteOrganizationGroupResponse> {
  return runDeleteOrganizationGroupWorkflow(
    runtime.db,
    organizationId,
    groupId,
    sessionUserId,
  );
}

export async function listOrganizationGroupMembers(
  runtime: ApiServiceRuntime,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<OrganizationGroupMembersResponse> {
  return runListOrganizationGroupMembersWorkflow(
    runtime.db,
    organizationId,
    groupId,
    sessionUserId,
  );
}

export async function listOrganizationGroupContainers(
  runtime: ApiServiceRuntime,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
): Promise<OrganizationGroupContainersResponse> {
  return runListOrganizationGroupContainersWorkflow(
    runtime.db,
    organizationId,
    groupId,
    sessionUserId,
  );
}
