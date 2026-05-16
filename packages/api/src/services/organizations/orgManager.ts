import type { CreateOrganizationGroupRequest } from "@tearleads/validators/request";
import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";
import {
  OrganizationManagerError,
  runCreateOrganizationGroupWorkflow,
  runListOrganizationContainerGrantsWorkflow,
  runListOrganizationDirectoryWorkflow,
  runListOrganizationGroupContainersWorkflow,
  runListOrganizationGroupMembersWorkflow,
  runListOrganizationGroupsWorkflow,
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
