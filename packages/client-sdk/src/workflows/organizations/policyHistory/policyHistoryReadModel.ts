import type {
  PrincipalPolicyBundleResponse,
  PrincipalProjectionMemberResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import type {
  OrganizationGroupPolicyHistory,
  OrganizationPolicyHistory,
  OrganizationPrincipalMemberChange,
  OrganizationPrincipalPolicyHistoryEntry,
} from "./policyHistoryTypes";

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
} from "./policyHistoryTypes";

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

export function diffPrincipalProjectionMembers(input: {
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

// Entries run newest first; the oldest one held is the cursor for older
// entries unless it is genesis.
function olderEntriesCursor(
  entries: ReadonlyArray<OrganizationPrincipalPolicyHistoryEntry>,
): number | null {
  const oldestVersion = entries.at(-1)?.version;
  return oldestVersion !== undefined && oldestVersion > 1
    ? oldestVersion
    : null;
}

export function buildOrganizationGroupPolicyHistory(
  bundle: PrincipalPolicyBundleResponse,
  organizationId: string,
): OrganizationGroupPolicyHistory {
  const entries = buildPrincipalPolicyHistoryEntries(bundle);
  return {
    entries,
    groupId: bundle.currentState.principalId,
    nextBeforeVersion: olderEntriesCursor(entries),
    organizationId,
    principalId: bundle.currentState.principalId,
    principalType: "group",
  };
}

export function buildOrganizationPolicyHistory(
  bundle: PrincipalPolicyBundleResponse,
): OrganizationPolicyHistory {
  const entries = buildPrincipalPolicyHistoryEntries(bundle);
  return {
    entries: entries.map((entry) => ({ ...entry, groupChanges: null })),
    nextBeforeVersion: olderEntriesCursor(entries),
    organizationId: bundle.currentState.principalId,
    principalId: bundle.currentState.principalId,
    principalType: "organization",
  };
}
