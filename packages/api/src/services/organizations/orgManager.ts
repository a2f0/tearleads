import type {
  CreateOrganizationGroupWithPolicyRequest,
  DeleteOrganizationGroupRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  CreateOrganizationGroupResponse,
  DeleteOrganizationGroupResponse,
  OrganizationDataUsageResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupMembersResponse,
  OrganizationProfileResponse,
  OrganizationReadModelResponse,
} from "@tearleads/validators/response";
import { runCreateOrganizationGroupWorkflow } from "../../workflows/organizations/createGroup";
import { runGetOrganizationDataUsageWorkflow } from "../../workflows/organizations/dataUsage";
import {
  OrganizationManagerError,
  OrganizationReadModelCursorError,
} from "../../workflows/organizations/errors";
import {
  runDeleteOrganizationGroupWorkflow,
  runListOrganizationGroupMembersWorkflow,
} from "../../workflows/organizations/groups";
import { runUpdateOrganizationProfileWorkflow } from "../../workflows/organizations/profileMutation";
import { runGetOrganizationReadModelWorkflow } from "../../workflows/organizations/readModelFeed";
import { runUpdateOrganizationRosterEntryWorkflow } from "../../workflows/organizations/rosterMutation";
import type { ApiServiceRuntime } from "../runtime";

export { OrganizationManagerError, OrganizationReadModelCursorError };

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

export async function getOrganizationReadModel(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  cursor: string | undefined,
): Promise<OrganizationReadModelResponse> {
  return runGetOrganizationReadModelWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    cursor,
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

export async function updateOrganizationProfile(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  input: UpdateOrganizationProfileRequest,
): Promise<OrganizationProfileResponse> {
  return runUpdateOrganizationProfileWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    input,
  );
}

export async function createOrganizationGroup(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  input: CreateOrganizationGroupWithPolicyRequest,
): Promise<CreateOrganizationGroupResponse> {
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
  input: DeleteOrganizationGroupRequest,
): Promise<DeleteOrganizationGroupResponse> {
  return runDeleteOrganizationGroupWorkflow(
    runtime.db,
    organizationId,
    groupId,
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
