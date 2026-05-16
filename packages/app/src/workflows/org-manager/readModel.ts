import type {
  ListOrganizationGroupsResponse,
  OrganizationContainerGrantResponse,
  OrganizationContainerGrantsResponse,
  OrganizationDirectoryResponse,
  OrganizationDirectoryUserResponse,
  OrganizationGroupContainerResponse,
  OrganizationGroupContainersResponse,
  OrganizationGroupMemberResponse,
  OrganizationGroupMembersResponse,
  OrganizationGroupSummaryResponse,
} from "@tearleads/validators/response";

export type OrgManagerDirectory = OrganizationDirectoryResponse;
export type OrgManagerDirectoryUser = OrganizationDirectoryUserResponse;
export type OrgManagerContainerGrant = OrganizationContainerGrantResponse;
export type OrgManagerContainerGrants = OrganizationContainerGrantsResponse;
export type OrgManagerGroupContainer = OrganizationGroupContainerResponse;
export type OrgManagerGroupContainers = OrganizationGroupContainersResponse;
export type OrgManagerGroupMember = OrganizationGroupMemberResponse;
export type OrgManagerGroupMembers = OrganizationGroupMembersResponse;
export type OrgManagerGroupSummary = OrganizationGroupSummaryResponse;

export interface OrgManagerDirectoryAndGroups {
  readonly directory: OrgManagerDirectory;
  readonly groups: ReadonlyArray<OrgManagerGroupSummary>;
}

export interface OrgManagerGroupDetails {
  readonly members: OrgManagerGroupMembers | null;
  readonly containers: OrgManagerGroupContainers | null;
}

interface OrgManagerReadApi {
  readonly listOrganizationDirectory: (
    organizationId: string,
  ) => Promise<OrganizationDirectoryResponse | null>;
  readonly listOrganizationGroups: (
    organizationId: string,
  ) => Promise<ListOrganizationGroupsResponse | null>;
  readonly listOrganizationContainerGrants: (
    organizationId: string,
  ) => Promise<OrganizationContainerGrantsResponse | null>;
  readonly listOrganizationGroupMembers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupMembersResponse | null>;
  readonly listOrganizationGroupContainers: (
    organizationId: string,
    groupId: string,
  ) => Promise<OrganizationGroupContainersResponse | null>;
}

export async function loadOrgManagerDirectoryAndGroups(input: {
  readonly apiClient: Pick<
    OrgManagerReadApi,
    "listOrganizationDirectory" | "listOrganizationGroups"
  >;
  readonly organizationId: string;
}): Promise<OrgManagerDirectoryAndGroups | null> {
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

export async function loadOrgManagerGrants(input: {
  readonly apiClient: Pick<
    OrgManagerReadApi,
    "listOrganizationContainerGrants"
  >;
  readonly organizationId: string;
}): Promise<OrgManagerContainerGrants | null> {
  return input.apiClient.listOrganizationContainerGrants(input.organizationId);
}

export async function loadOrgManagerGroupDetails(input: {
  readonly apiClient: Pick<
    OrgManagerReadApi,
    "listOrganizationGroupContainers" | "listOrganizationGroupMembers"
  >;
  readonly groupId: string;
  readonly organizationId: string;
}): Promise<OrgManagerGroupDetails> {
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

  return {
    members,
    containers,
  };
}
