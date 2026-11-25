import type {
  CreateOrganizationGroupWithPolicyRequest,
  DeleteOrganizationGroupRequest,
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
  UpdateOrganizationRosterTwoFactorRequest,
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
import { resolveApiIdentityTrustDomain } from "../../apiIdentityTrustDomain";
import { runCreateOrganizationGroupWorkflow } from "../../workflows/organizations/createGroup";
import { runGetOrganizationDataUsageWorkflow } from "../../workflows/organizations/dataUsage";
import {
  OrganizationManagerError,
  OrganizationReadModelCursorError,
} from "../../workflows/organizations/errors";
import { runListOrganizationGroupMembersWorkflow } from "../../workflows/organizations/groupMembers";
import { runDeleteOrganizationGroupWorkflow } from "../../workflows/organizations/groups";
import { runUpdateOrganizationProfileWorkflow } from "../../workflows/organizations/profileMutation";
import { runGetOrganizationReadModelWorkflow } from "../../workflows/organizations/readModelFeed";
import { runUpdateOrganizationRosterEntryWorkflow } from "../../workflows/organizations/rosterMutation";
import { runUpdateOrganizationRosterTwoFactorWorkflow } from "../../workflows/organizations/rosterTwoFactor";
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

/** The session store calls a requirement change sweeps a member's sessions with. */
export interface RosterTwoFactorSessionStore {
  readonly destroyUserSession: (input: {
    sessionId: string;
    userId: string;
  }) => Promise<boolean>;
  readonly listUserSessions: (input: {
    currentToken: string;
    userId: string;
  }) => Promise<
    readonly { readonly id: string; readonly twoFactorVerified: boolean }[]
  >;
}

/**
 * Sets a member's two-factor requirement, then revokes the member's sessions
 * that did not pass a second factor: each holds the requirements read when it
 * opened, and its silent renewal reads them again. Sessions that passed one
 * already satisfy any requirement. Sign-in re-reads the requirements after
 * storing a session, so a login racing this change leaves either a session
 * the sweep finds or one that read the new requirement.
 */
export async function updateOrganizationRosterTwoFactor(
  runtime: ApiServiceRuntime,
  sessions: RosterTwoFactorSessionStore,
  input: {
    readonly organizationId: string;
    readonly request: UpdateOrganizationRosterTwoFactorRequest;
    readonly sessionUserId: string;
    readonly userId: string;
  },
): Promise<OrganizationDirectoryUserResponse> {
  const { changed, user } = await runUpdateOrganizationRosterTwoFactorWorkflow(
    runtime.db,
    input.organizationId,
    input.userId,
    input.sessionUserId,
    input.request,
  );
  if (changed) {
    const live = await sessions.listUserSessions({
      currentToken: "",
      userId: input.userId,
    });
    await Promise.all(
      live
        .filter((session) => !session.twoFactorVerified)
        .map((session) =>
          sessions.destroyUserSession({
            sessionId: session.id,
            userId: input.userId,
          }),
        ),
    );
  }
  return user;
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
  requestUrl?: string,
  readModelCursor?: string,
): Promise<CreateOrganizationGroupResponse> {
  return runCreateOrganizationGroupWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    input,
    resolveApiIdentityTrustDomain(runtime.identityTrustDomain, requestUrl),
    readModelCursor,
  );
}

export async function deleteOrganizationGroup(
  runtime: ApiServiceRuntime,
  organizationId: string,
  groupId: string,
  sessionUserId: string,
  input: DeleteOrganizationGroupRequest,
  requestUrl?: string,
): Promise<DeleteOrganizationGroupResponse> {
  return runDeleteOrganizationGroupWorkflow(
    runtime.db,
    organizationId,
    groupId,
    sessionUserId,
    input,
    resolveApiIdentityTrustDomain(runtime.identityTrustDomain, requestUrl),
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
