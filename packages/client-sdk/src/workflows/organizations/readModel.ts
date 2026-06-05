import type { UpdateOrganizationRosterEntryRequest } from "@tearleads/validators/request";
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
  PrincipalPolicyBundleResponse,
  PrincipalProjectionMemberResponse,
  PrincipalStateResponse,
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
export type OrganizationPrincipalMemberChangeType =
  | "added"
  | "removed"
  | "role_changed";
export interface OrganizationPrincipalMemberChange {
  readonly changeType: OrganizationPrincipalMemberChangeType;
  readonly memberPrincipalId: string;
  readonly memberPrincipalType: PrincipalProjectionMemberResponse["memberPrincipalType"];
  readonly nextRole: PrincipalProjectionMemberResponse["role"] | null;
  readonly previousRole: PrincipalProjectionMemberResponse["role"] | null;
}
export interface OrganizationPrincipalPolicyHistoryEntry {
  readonly changes: OrganizationPrincipalMemberChange[];
  readonly createdAt: string;
  readonly keyEpoch: number;
  readonly memberCount: number;
  readonly signedAt: string;
  readonly signerUserId: string;
  readonly signerUserKeyFingerprint: string;
  readonly stateHash: string;
  readonly version: number;
}
export type OrganizationGroupPolicyHistoryEntry =
  OrganizationPrincipalPolicyHistoryEntry;
export interface OrganizationPrincipalPolicyHistory {
  readonly entries: OrganizationPrincipalPolicyHistoryEntry[];
  readonly principalId: string;
  readonly principalType: PrincipalStateResponse["principalType"];
}
export interface OrganizationGroupPolicyHistory
  extends OrganizationPrincipalPolicyHistory {
  readonly groupId: string;
  readonly principalType: "group";
}
export interface OrganizationPolicyHistory
  extends OrganizationPrincipalPolicyHistory {
  readonly organizationId: string;
  readonly principalType: "organization";
}

export interface OrganizationDirectoryAndGroups {
  readonly directory: OrganizationDirectory;
  readonly groups: ReadonlyArray<OrganizationGroupSummary>;
  readonly memberGroupId: string | null;
}

export interface OrganizationGroupDetails {
  readonly members: OrganizationGroupMembers | null;
  readonly containers: OrganizationGroupContainers | null;
  readonly policyHistory: OrganizationGroupPolicyHistory | null;
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
  readonly updateOrganizationRosterEntry: (
    organizationId: string,
    userId: string,
    input: UpdateOrganizationRosterEntryRequest,
  ) => Promise<OrganizationDirectoryUserResponse | null>;
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

interface PrincipalPolicyHistoryState {
  readonly projection: ReadonlyArray<PrincipalProjectionMemberResponse>;
  readonly state: PrincipalStateResponse;
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

function projectionMemberKey(
  member: Pick<
    PrincipalProjectionMemberResponse,
    "memberPrincipalId" | "memberPrincipalType"
  >,
): string {
  return `${member.memberPrincipalType}:${member.memberPrincipalId}`;
}

function comparePrincipalMemberChanges(
  left: OrganizationPrincipalMemberChange,
  right: OrganizationPrincipalMemberChange,
): number {
  return (
    left.memberPrincipalType.localeCompare(right.memberPrincipalType) ||
    left.memberPrincipalId.localeCompare(right.memberPrincipalId) ||
    left.changeType.localeCompare(right.changeType)
  );
}

function diffPrincipalProjectionMembers(input: {
  readonly current: ReadonlyArray<PrincipalProjectionMemberResponse>;
  readonly previous: ReadonlyArray<PrincipalProjectionMemberResponse>;
}): OrganizationPrincipalMemberChange[] {
  const previousMembersByKey = new Map(
    input.previous.map((member) => [projectionMemberKey(member), member]),
  );
  const currentMembersByKey = new Map(
    input.current.map((member) => [projectionMemberKey(member), member]),
  );
  const changes: OrganizationPrincipalMemberChange[] = [];

  for (const currentMember of input.current) {
    const previousMember = previousMembersByKey.get(
      projectionMemberKey(currentMember),
    );
    if (!previousMember) {
      changes.push({
        changeType: "added",
        memberPrincipalId: currentMember.memberPrincipalId,
        memberPrincipalType: currentMember.memberPrincipalType,
        nextRole: currentMember.role,
        previousRole: null,
      });
      continue;
    }

    if (previousMember.role !== currentMember.role) {
      changes.push({
        changeType: "role_changed",
        memberPrincipalId: currentMember.memberPrincipalId,
        memberPrincipalType: currentMember.memberPrincipalType,
        nextRole: currentMember.role,
        previousRole: previousMember.role,
      });
    }
  }

  for (const previousMember of input.previous) {
    if (currentMembersByKey.has(projectionMemberKey(previousMember))) {
      continue;
    }

    changes.push({
      changeType: "removed",
      memberPrincipalId: previousMember.memberPrincipalId,
      memberPrincipalType: previousMember.memberPrincipalType,
      nextRole: null,
      previousRole: previousMember.role,
    });
  }

  return changes.sort(comparePrincipalMemberChanges);
}

function principalPolicyHistoryStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyHistoryState[] {
  return [
    ...bundle.previousStates.map((entry) => ({
      projection: entry.projection,
      state: entry.state,
    })),
    {
      projection: bundle.currentProjection,
      state: bundle.currentState,
    },
  ].sort((left, right) => left.state.version - right.state.version);
}

function buildPrincipalPolicyHistoryEntries(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationPrincipalPolicyHistoryEntry[] {
  const states = principalPolicyHistoryStates(bundle);
  const entries = states.map((entry, index) => {
    const previousProjection = states[index - 1]?.projection ?? [];

    return {
      changes: diffPrincipalProjectionMembers({
        current: entry.projection,
        previous: previousProjection,
      }),
      createdAt: entry.state.createdAt,
      keyEpoch: entry.state.keyEpoch,
      memberCount: entry.state.memberCount,
      signedAt: entry.state.signedAt,
      signerUserId: entry.state.signerUserId,
      signerUserKeyFingerprint: entry.state.signerUserKeyFingerprint,
      stateHash: entry.state.stateHash,
      version: entry.state.version,
    };
  });

  return entries.reverse();
}

export function buildOrganizationGroupPolicyHistory(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationGroupPolicyHistory {
  return {
    entries: buildPrincipalPolicyHistoryEntries(bundle),
    groupId: bundle.currentState.principalId,
    principalId: bundle.currentState.principalId,
    principalType: "group",
  };
}

export function buildOrganizationPolicyHistory(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationPolicyHistory {
  return {
    entries: buildPrincipalPolicyHistoryEntries(bundle),
    organizationId: bundle.currentState.principalId,
    principalId: bundle.currentState.principalId,
    principalType: "organization",
  };
}

export async function loadOrganizationGroupPolicyHistory(input: {
  readonly apiClient: Pick<OrganizationReadApi, "getCurrentPrincipalPolicy">;
  readonly groupId: string;
}): Promise<OrganizationGroupPolicyHistory | null> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "group",
    input.groupId,
  );

  return bundle ? buildOrganizationGroupPolicyHistory(bundle) : null;
}

export async function loadOrganizationPolicyHistory(input: {
  readonly apiClient: Pick<OrganizationReadApi, "getCurrentPrincipalPolicy">;
  readonly organizationId: string;
}): Promise<OrganizationPolicyHistory | null> {
  const bundle = await input.apiClient.getCurrentPrincipalPolicy(
    "organization",
    input.organizationId,
  );

  return bundle ? buildOrganizationPolicyHistory(bundle) : null;
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
    memberGroupId: groups.memberGroupId ?? null,
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
