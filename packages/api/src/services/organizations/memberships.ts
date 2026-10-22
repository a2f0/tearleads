import type { UpdateOrganizationMembershipRequest } from "@tearleads/validators/request";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import {
  runListOrganizationMembershipsWorkflow,
  runRequestOrganizationLeaveWorkflow,
  runUpdateOrganizationMembershipWorkflow,
  runWithdrawOrganizationLeaveRequestWorkflow,
} from "../../workflows/organizations/memberships";
import type { ApiServiceRuntime } from "../runtime";

export async function listOrganizationMemberships(
  runtime: ApiServiceRuntime,
  sessionUserId: string,
): Promise<OrganizationMembershipsResponse> {
  return runListOrganizationMembershipsWorkflow(runtime.db, sessionUserId);
}

export async function updateOrganizationMembership(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  input: UpdateOrganizationMembershipRequest,
): Promise<OrganizationMembershipResponse> {
  return runUpdateOrganizationMembershipWorkflow(runtime.db, {
    organizationId,
    syncPaused: input.syncPaused,
    userId: sessionUserId,
  });
}

export async function requestOrganizationLeave(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  request: OrganizationLeaveRequest,
): Promise<OrganizationMembershipResponse> {
  return runRequestOrganizationLeaveWorkflow(runtime.db, {
    organizationId,
    request,
    userId: sessionUserId,
  });
}

export async function withdrawOrganizationLeaveRequest(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationMembershipResponse> {
  return runWithdrawOrganizationLeaveRequestWorkflow(runtime.db, {
    organizationId,
    userId: sessionUserId,
  });
}
