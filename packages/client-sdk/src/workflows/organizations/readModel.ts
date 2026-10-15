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
  OrganizationGroupSummaryResponse,
  OrganizationProfileResponse,
  OrganizationReadModelGroupMemberResponse,
  OrganizationUserDetailResponse,
} from "@tearleads/validators/response";
import type { OrganizationGroupPolicyHistory } from "./policyHistoryReadModel";

export type {
  OrganizationGroupPolicyHistory,
  OrganizationGroupPolicyHistoryEntry,
  OrganizationPolicyGrantChange,
  OrganizationPolicyGroupChange,
  OrganizationPolicyHistory,
  OrganizationPolicyHistoryEntry,
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
  readonly groupName: string | null;
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
  extends Omit<OrganizationUserDetailResponse, "grants" | "groups"> {
  readonly groups: OrganizationGroupSummary[];
  readonly grants: {
    readonly directGrants: OrganizationContainerGrant[];
    readonly groupGrants: OrganizationContainerGrant[];
  };
}
/** A projected group member: public keys live in the directory lane only. */
export type OrganizationGroupMember = OrganizationReadModelGroupMemberResponse;
export interface OrganizationGroupMembers {
  readonly groupId: string;
  readonly members: OrganizationGroupMember[];
  readonly organizationId: string;
}
export type OrganizationGroupSummary = OrganizationGroupSummaryResponse & {
  readonly name: string;
  /**
   * The group's signed name does not open under the metadata key this member
   * holds; only a dishonest admin signs such a name. `name` is then empty, and
   * the group must not be offered for selection by name.
   */
  readonly nameUnreadable: boolean;
};
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
