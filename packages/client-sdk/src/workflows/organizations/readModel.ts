import type {
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  OrganizationContainerGrantResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupContainerResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
  OrganizationProfileResponse,
  OrganizationUserDetailResponse,
} from "@tearleads/validators/response";
import type { OrganizationGroupPolicyHistory } from "./policyHistoryReadModel";

export type {
  OrganizationGroupPolicyHistory,
  OrganizationGroupPolicyHistoryEntry,
  OrganizationPolicyHistory,
  OrganizationPrincipalMemberChange,
  OrganizationPrincipalMemberChangeType,
  OrganizationPrincipalPolicyHistory,
  OrganizationPrincipalPolicyHistoryEntry,
} from "./policyHistoryReadModel";
export {
  buildOrganizationGroupPolicyHistory,
  buildOrganizationPolicyHistory,
} from "./policyHistoryReadModel";

export type OrganizationDirectory = OrganizationDirectoryResponse;
export type OrganizationDirectoryUser = OrganizationDirectoryUserResponse;
export type OrganizationProfile = OrganizationProfileResponse;
export type OrganizationGroupContainer = OrganizationGroupContainerResponse & {
  readonly containerDisplayName: string | null;
};
export type OrganizationContainerGrant = OrganizationContainerGrantResponse & {
  readonly containerDisplayName: string | null;
};
export interface OrganizationGroupContainers
  extends Omit<OrganizationGroupContainersResponse, "containers"> {
  readonly containers: OrganizationGroupContainer[];
}
export interface OrganizationContainerGrants
  extends Omit<OrganizationContainerGrantsResponse, "grants"> {
  readonly grants: OrganizationContainerGrant[];
}
export interface OrganizationUserDetail
  extends Omit<OrganizationUserDetailResponse, "grants"> {
  readonly grants: {
    readonly directGrants: OrganizationContainerGrant[];
    readonly groupGrants: OrganizationContainerGrant[];
  };
}
export type OrganizationGroupMember = OrganizationGroupMemberResponse;
export type OrganizationGroupMembers = OrganizationGroupMembersResponse;
export type OrganizationGroupSummary = OrganizationGroupSummaryResponse;
export interface OrganizationDirectoryAndGroups {
  readonly directory: OrganizationDirectory;
  readonly groups: ReadonlyArray<OrganizationGroupSummary>;
  readonly memberGroupId: string;
  readonly readModelCursor: string;
}

export interface OrganizationGroupDetails {
  readonly members: OrganizationGroupMembers | null;
  readonly containers: OrganizationGroupContainers | null;
  readonly policyHistory: OrganizationGroupPolicyHistory | null;
}

interface OrganizationReadApi {
  readonly updateOrganizationRosterEntry: (
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) => Promise<OrganizationDirectoryUserResponse | null>;
  readonly updateOrganizationProfile: (
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) => Promise<OrganizationProfileResponse | null>;
}

export async function updateOrganizationRosterEntry(input: {
  readonly apiClient: Pick<
    OrganizationReadApi,
    "updateOrganizationRosterEntry"
  >;
  readonly organizationId: string;
  readonly profileDocumentId: string | null;
  readonly userId: string;
}): Promise<OrganizationDirectoryUser | null> {
  return input.apiClient.updateOrganizationRosterEntry(
    input.organizationId,
    input.userId,
    { profileDocumentId: input.profileDocumentId },
  );
}

export async function updateOrganizationProfile(input: {
  readonly apiClient: Pick<OrganizationReadApi, "updateOrganizationProfile">;
  readonly organizationId: string;
  readonly profileDocumentId: string | null;
}): Promise<OrganizationProfileResponse | null> {
  return input.apiClient.updateOrganizationProfile(input.organizationId, {
    profileDocumentId: input.profileDocumentId,
  });
}
