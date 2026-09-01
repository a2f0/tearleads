import type {
  PrincipalPolicyBundleResponse,
  PrincipalProjectionMemberResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";

export type OrganizationPrincipalMemberChangeType =
  | "added"
  | "removed"
  | "role_changed";
export interface OrganizationPrincipalMemberChange {
  readonly changeType: OrganizationPrincipalMemberChangeType;
  readonly userId: string;
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
  readonly organizationId: string;
  readonly principalType: "group";
}
export interface OrganizationPolicyHistory
  extends OrganizationPrincipalPolicyHistory {
  readonly organizationId: string;
  readonly principalType: "organization";
}

interface PrincipalPolicyHistoryState {
  readonly projection: ReadonlyArray<PrincipalProjectionMemberResponse>;
  readonly state: PrincipalStateResponse;
}

function projectionMemberKey(
  member: Pick<PrincipalProjectionMemberResponse, "userId">,
): string {
  return member.userId;
}

function comparePrincipalMemberChanges(
  left: OrganizationPrincipalMemberChange,
  right: OrganizationPrincipalMemberChange,
): number {
  return (
    left.userId.localeCompare(right.userId) ||
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
        userId: currentMember.userId,
        nextRole: currentMember.role,
        previousRole: null,
      });
      continue;
    }

    if (previousMember.role !== currentMember.role) {
      changes.push({
        changeType: "role_changed",
        userId: currentMember.userId,
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
      userId: previousMember.userId,
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
  organizationId: string,
): OrganizationGroupPolicyHistory {
  return {
    entries: buildPrincipalPolicyHistoryEntries(bundle),
    groupId: bundle.currentState.principalId,
    organizationId,
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
