import type { UpdateOrganizationMembershipRequest } from "@tearleads/validators/request";
import type {
  OrganizationMembershipResponse,
  OrganizationMembershipsResponse,
} from "@tearleads/validators/response";
import {
  runListOrganizationMembershipsWorkflow,
  runUpdateOrganizationMembershipWorkflow,
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
