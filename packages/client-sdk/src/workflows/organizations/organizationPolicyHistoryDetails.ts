import type {
  PrincipalContainerGrant,
  PrincipalPolicyStateChainEntry,
} from "@tearleads/crypto";
import type { OrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import { verifyOrganizationPolicyHistory } from "./organizationPolicyHistoryVerification";
import {
  buildOrganizationPolicyHistory,
  diffPrincipalProjectionMembers,
  type OrganizationPolicyHistory,
} from "./policyHistoryReadModel";
import type {
  OrganizationPolicyGrantChange,
  OrganizationPolicyGroupChange,
} from "./policyHistoryTypes";

function diffGrants(
  previous: readonly PrincipalContainerGrant[],
  current: readonly PrincipalContainerGrant[],
): OrganizationPolicyGrantChange[] {
  const before = new Map(
    previous.map((grant) => [grant.containerId, grant.accessLevel]),
  );
  const after = new Map(
    current.map((grant) => [grant.containerId, grant.accessLevel]),
  );
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .flatMap((containerId) => {
      const previousAccess = before.get(containerId) ?? null;
      const nextAccess = after.get(containerId) ?? null;
      return previousAccess === nextAccess
        ? []
        : [{ containerId, previousAccess, nextAccess }];
    });
}

function describeGroupChange(
  previous: OrganizationGroupHead | undefined,
  current: OrganizationGroupHead | undefined,
  groupState: (head: OrganizationGroupHead) => PrincipalPolicyStateChainEntry,
): OrganizationPolicyGroupChange {
  const head = current ?? previous;
  if (!head) throw new Error("Group change has no state");
  const oldEntry = previous ? groupState(previous) : null;
  const newEntry = current ? groupState(current) : null;
  return {
    groupId: head.principalId,
    changeType: !previous ? "created" : !current ? "deleted" : "updated",
    previousVersion: previous?.version ?? null,
    version: head.version,
    previousKeyEpoch: previous?.keyEpoch ?? null,
    keyEpoch: head.keyEpoch,
    changes: newEntry
      ? diffPrincipalProjectionMembers({
          previous: oldEntry?.projection ?? [],
          current: newEntry.projection,
        })
      : [],
    grantChanges: newEntry
      ? diffGrants(oldEntry?.grants ?? [], newEntry.grants)
      : [],
  };
}

function diffGroups(
  previousHeads: readonly OrganizationGroupHead[],
  heads: readonly OrganizationGroupHead[],
  groupState: (head: OrganizationGroupHead) => PrincipalPolicyStateChainEntry,
): OrganizationPolicyGroupChange[] {
  const before = new Map(previousHeads.map((head) => [head.principalId, head]));
  const after = new Map(heads.map((head) => [head.principalId, head]));
  const changes: OrganizationPolicyGroupChange[] = [];
  for (const groupId of [
    ...new Set([...before.keys(), ...after.keys()]),
  ].sort()) {
    const previous = before.get(groupId);
    const current = after.get(groupId);
    if (previous?.stateHash === current?.stateHash) continue;
    changes.push(describeGroupChange(previous, current, groupState));
  }
  return changes;
}

/** Derived in memory; names remain in their existing encrypted sources. */
export async function buildDetailedOrganizationPolicyHistory(
  input: Parameters<typeof verifyOrganizationPolicyHistory>[0],
): Promise<OrganizationPolicyHistory> {
  const { descriptors, groups } = await verifyOrganizationPolicyHistory(input);
  const states = [
    ...input.bundle.previousStates.map((entry) => entry.state),
    input.bundle.currentState,
  ].sort((a, b) => a.version - b.version);
  const groupState = (
    head: OrganizationGroupHead,
  ): PrincipalPolicyStateChainEntry => {
    const entry = groups
      .find((group) => group.principalId === head.principalId)
      ?.history.find((entry) => entry.state.stateHash === head.stateHash);
    if (!entry) throw new Error("Verified group history state is missing");
    return entry;
  };
  const byState = new Map<string, OrganizationPolicyGroupChange[]>();
  let previousHeads: readonly OrganizationGroupHead[] = [];
  for (const state of states) {
    const heads = descriptors.get(state.stateHash)?.groupHeads;
    if (!heads) throw new Error("Verified organization directory is missing");
    byState.set(state.stateHash, diffGroups(previousHeads, heads, groupState));
    previousHeads = heads;
  }
  const history = buildOrganizationPolicyHistory(input.bundle);
  return {
    ...history,
    entries: history.entries.map((entry) => ({
      ...entry,
      groupChanges: byState.get(entry.stateHash) ?? [],
    })),
  };
}
