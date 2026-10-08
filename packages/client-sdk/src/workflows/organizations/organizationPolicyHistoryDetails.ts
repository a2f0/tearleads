import {
  type PrincipalContainerGrant,
  type PrincipalPolicyStateChainEntry,
  principalPolicyMatchesReference,
} from "@tearleads/crypto";
import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
} from "../../data/keyingProjectionVerification/types";
import type { OrganizationGroupHead } from "../../data/principals/organizationAuthorityDescriptor";
import { buildOrganizationGroupPolicyHistoryPage } from "./groupPolicyHistoryPage";
import { verifyOrganizationPolicyHistory } from "./organizationPolicyHistoryVerification";
import {
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

/** Display only: historical group selections never advance current checkpoints. */
export async function buildDetailedOrganizationPolicyHistory(
  input: Parameters<typeof verifyOrganizationPolicyHistory>[0] & {
    readonly resolveHistory: NonNullable<
      ReferencedPrincipalPolicyWarmer["resolveProjectionHistory"]
    >;
    readonly stillCurrent: () => boolean;
  },
): Promise<OrganizationPolicyHistory> {
  input = {
    ...input,
    head: structuredClone(input.head),
    page: structuredClone(input.page),
    evidence: structuredClone(input.evidence),
  };
  const { descriptors, references } =
    await verifyOrganizationPolicyHistory(input);
  assertProjectionVerificationCurrent(input.stillCurrent);
  const resolved = await input.resolveHistory({
    organizationId: input.head.principalId,
    evidence: input.evidence.evidence,
    references,
    stillCurrent: input.stillCurrent,
  });
  assertProjectionVerificationCurrent(
    () => input.stillCurrent() && resolved.stillCurrent(),
  );
  const groupState = (
    head: OrganizationGroupHead,
  ): PrincipalPolicyStateChainEntry => {
    const policy = resolved.policies.find((policy) =>
      principalPolicyMatchesReference({ policy, reference: head }),
    );
    const entry = policy?.retainedHistory.find(
      (entry) => entry.state.stateHash === head.stateHash,
    );
    if (!entry) throw new Error("Verified group history state is missing");
    return entry;
  };
  const basic = buildOrganizationGroupPolicyHistoryPage({
    page: input.page,
    groupId: input.head.principalId,
    organizationId: input.head.principalId,
  });
  const byState = new Map<string, OrganizationPolicyGroupChange[]>();
  let previousHeads: readonly OrganizationGroupHead[] = input.page.predecessor
    ? (descriptors.get(input.page.predecessor.state.stateHash)?.groupHeads ??
      [])
    : [];
  for (const { state } of input.page.entries) {
    const heads = descriptors.get(state.stateHash)?.groupHeads;
    if (!heads) throw new Error("Verified organization directory is missing");
    byState.set(state.stateHash, diffGroups(previousHeads, heads, groupState));
    previousHeads = heads;
  }
  return {
    principalId: input.head.principalId,
    principalType: "organization",
    organizationId: input.head.principalId,
    nextBeforeVersion: input.page.nextBeforeVersion,
    entries: basic.entries.map((entry) => ({
      ...entry,
      groupChanges: byState.get(entry.stateHash) ?? [],
    })),
  };
}
