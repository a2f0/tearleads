import type {
  UpdateOrganizationProfileRequest,
  UpdateOrganizationRosterEntryRequest,
} from "@tearleads/validators/request";
import type {
  OrganizationContainerGrantResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDataUsageResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupContainerResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
  OrganizationProfileResponse,
  OrganizationUserDetailResponse,
  PrincipalPolicyBundleResponse,
} from "@tearleads/validators/response";
import { loadContainerDisplayNamesByIds } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  loadOrganizationGroupPolicyHistory,
  type OrganizationGroupPolicyHistory,
} from "./policyHistoryReadModel";

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
  loadOrganizationGroupPolicyHistory,
  loadOrganizationPolicyHistory,
} from "./policyHistoryReadModel";

export type OrganizationDirectory = OrganizationDirectoryResponse;
export type OrganizationDataUsage = OrganizationDataUsageResponse;
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
    readonly organizationGrants: OrganizationContainerGrant[];
  };
}
export type OrganizationGroupMember = OrganizationGroupMemberResponse;
export type OrganizationGroupMembers = OrganizationGroupMembersResponse;
export type OrganizationGroupSummary = OrganizationGroupSummaryResponse;
export interface OrganizationDirectoryAndGroups {
  readonly directory: OrganizationDirectory;
  readonly groups: ReadonlyArray<OrganizationGroupSummary>;
  readonly memberGroupId: string;
}

export interface OrganizationGroupDetails {
  readonly members: OrganizationGroupMembers | null;
  readonly containers: OrganizationGroupContainers | null;
  readonly policyHistory: OrganizationGroupPolicyHistory | null;
}

interface OrganizationReadApi {
  readonly listOrganizationContainerGrants: (
    organizationId: string,
  ) => Promise<OrganizationContainerGrantsResponse | null>;
  readonly getOrganizationDataUsage: (
    organizationId: string,
  ) => Promise<OrganizationDataUsageResponse | null>;
  readonly getOrganizationUserDetail: (
    organizationId: string,
    userId: string,
  ) => Promise<OrganizationUserDetailResponse | null>;
  readonly updateOrganizationRosterEntry: (
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) => Promise<OrganizationDirectoryUserResponse | null>;
  readonly updateOrganizationProfile: (
    organizationId: string,
    input: UpdateOrganizationProfileRequest,
  ) => Promise<OrganizationProfileResponse | null>;
  readonly listOrganizationGroupMembers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupMembersResponse | null>;
  readonly listOrganizationGroupContainers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupContainersResponse | null>;
  readonly getCurrentPrincipalPolicy: (
    principalType: "group" | "organization",
    principalId: string,
  ) => Promise<PrincipalPolicyBundleResponse | null>;
}

function uniqueContainerIds(
  containers: ReadonlyArray<
    Pick<OrganizationGroupContainerResponse, "containerId">
  >,
): string[] {
  return [...new Set(containers.map((container) => container.containerId))];
}

async function loadContainerDisplayNamesById(input: {
  readonly containerIds: readonly string[];
  readonly execSql?: ExecSql | null | undefined;
}): Promise<Map<string, string>> {
  if (!input.execSql || input.containerIds.length === 0) {
    return new Map();
  }

  return loadContainerDisplayNamesByIds(input.execSql, input.containerIds);
}

function withContainerDisplayNames<
  TContainer extends OrganizationGroupContainerResponse,
>(
  containers: ReadonlyArray<TContainer>,
  displayNamesById: ReadonlyMap<string, string>,
): Array<TContainer & { readonly containerDisplayName: string | null }> {
  return containers.map((container) => ({
    ...container,
    containerDisplayName: displayNamesById.get(container.containerId) ?? null,
  }));
}

export async function loadOrganizationContainerGrants(input: {
  readonly apiClient: Pick<
    OrganizationReadApi,
    "listOrganizationContainerGrants"
  >;
  readonly execSql?: ExecSql | null | undefined;
  readonly organizationId: string;
}): Promise<OrganizationContainerGrants | null> {
  const grants = await input.apiClient.listOrganizationContainerGrants(
    input.organizationId,
  );
  if (!grants) {
    return null;
  }

  const displayNamesById = await loadContainerDisplayNamesById({
    containerIds: uniqueContainerIds(grants.grants),
    execSql: input.execSql,
  });

  return {
    ...grants,
    grants: withContainerDisplayNames(grants.grants, displayNamesById),
  };
}

export async function loadOrganizationDataUsage(input: {
  readonly apiClient: Pick<OrganizationReadApi, "getOrganizationDataUsage">;
  readonly organizationId: string;
}): Promise<OrganizationDataUsage | null> {
  return input.apiClient.getOrganizationDataUsage(input.organizationId);
}

export async function loadOrganizationUserDetail(input: {
  readonly apiClient: Pick<OrganizationReadApi, "getOrganizationUserDetail">;
  readonly execSql?: ExecSql | null | undefined;
  readonly organizationId: string;
  readonly userId: string;
}): Promise<OrganizationUserDetail | null> {
  const detail = await input.apiClient.getOrganizationUserDetail(
    input.organizationId,
    input.userId,
  );
  if (!detail) {
    return null;
  }

  const grants = [
    ...detail.grants.directGrants,
    ...detail.grants.groupGrants,
    ...detail.grants.organizationGrants,
  ];
  const displayNamesById = await loadContainerDisplayNamesById({
    containerIds: uniqueContainerIds(grants),
    execSql: input.execSql,
  });

  return {
    ...detail,
    grants: {
      directGrants: withContainerDisplayNames(
        detail.grants.directGrants,
        displayNamesById,
      ),
      groupGrants: withContainerDisplayNames(
        detail.grants.groupGrants,
        displayNamesById,
      ),
      organizationGrants: withContainerDisplayNames(
        detail.grants.organizationGrants,
        displayNamesById,
      ),
    },
  };
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

export async function loadOrganizationGroupDetails(input: {
  readonly apiClient: Pick<
    OrganizationReadApi,
    | "getCurrentPrincipalPolicy"
    | "listOrganizationGroupContainers"
    | "listOrganizationGroupMembers"
  >;
  readonly execSql?: ExecSql | null | undefined;
  readonly groupId: string;
  readonly organizationId: string;
}): Promise<OrganizationGroupDetails> {
  const [members, containers, policyHistory] = await Promise.all([
    input.apiClient.listOrganizationGroupMembers(
      input.organizationId,
      input.groupId,
    ),
    input.apiClient.listOrganizationGroupContainers(
      input.organizationId,
      input.groupId,
    ),
    loadOrganizationGroupPolicyHistory({
      apiClient: input.apiClient,
      groupId: input.groupId,
    }),
  ]);

  const displayNamesById = await loadContainerDisplayNamesById({
    containerIds: containers ? uniqueContainerIds(containers.containers) : [],
    execSql: input.execSql,
  });

  return {
    members,
    policyHistory,
    containers: containers
      ? {
          ...containers,
          containers: withContainerDisplayNames(
            containers.containers,
            displayNamesById,
          ),
        }
      : null,
  };
}
