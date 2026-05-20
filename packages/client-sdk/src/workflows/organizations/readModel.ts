import type {
  ListOrganizationGroupsResponse,
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
  OrganizationUserDetailResponse,
} from "@tearleads/validators/response";
import { loadContainerDisplayNamesByIds } from "../../data/persistence/containers/containerPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type OrganizationDirectory = OrganizationDirectoryResponse;
export type OrganizationDataUsage = OrganizationDataUsageResponse;
export type OrganizationDirectoryUser = OrganizationDirectoryUserResponse;
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
}

export interface OrganizationGroupDetails {
  readonly members: OrganizationGroupMembers | null;
  readonly containers: OrganizationGroupContainers | null;
}

interface OrganizationReadApi {
  readonly listOrganizationDirectory: (
    organizationId: string,
  ) => Promise<OrganizationDirectoryResponse | null>;
  readonly listOrganizationGroups: (
    organizationId: string,
  ) => Promise<ListOrganizationGroupsResponse | null>;
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
  readonly listOrganizationGroupMembers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupMembersResponse | null>;
  readonly listOrganizationGroupContainers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupContainersResponse | null>;
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

export async function loadOrganizationDirectoryAndGroups(input: {
  readonly apiClient: Pick<
    OrganizationReadApi,
    "listOrganizationDirectory" | "listOrganizationGroups"
  >;
  readonly organizationId: string;
}): Promise<OrganizationDirectoryAndGroups | null> {
  const [directory, groups] = await Promise.all([
    input.apiClient.listOrganizationDirectory(input.organizationId),
    input.apiClient.listOrganizationGroups(input.organizationId),
  ]);

  if (!directory || !groups) {
    return null;
  }

  return {
    directory,
    groups: groups.groups,
  };
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

export async function loadOrganizationGroupDetails(input: {
  readonly apiClient: Pick<
    OrganizationReadApi,
    "listOrganizationGroupContainers" | "listOrganizationGroupMembers"
  >;
  readonly execSql?: ExecSql | null | undefined;
  readonly groupId: string;
  readonly organizationId: string;
}): Promise<OrganizationGroupDetails> {
  const [members, containers] = await Promise.all([
    input.apiClient.listOrganizationGroupMembers(
      input.organizationId,
      input.groupId,
    ),
    input.apiClient.listOrganizationGroupContainers(
      input.organizationId,
      input.groupId,
    ),
  ]);

  const displayNamesById = await loadContainerDisplayNamesById({
    containerIds: containers ? uniqueContainerIds(containers.containers) : [],
    execSql: input.execSql,
  });

  return {
    members,
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
