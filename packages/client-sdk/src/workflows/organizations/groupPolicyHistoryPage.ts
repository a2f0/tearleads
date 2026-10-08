import type { RecoveredPrincipalHistoryPage } from "../principals/loadRecoveredPrincipalHistoryPage";
import { diffPrincipalProjectionMembers } from "./policyHistoryReadModel";
import type { OrganizationGroupPolicyHistory } from "./policyHistoryTypes";

/** Keep a page boundary's actual predecessor when describing membership changes. */
export function buildOrganizationGroupPolicyHistoryPage(input: {
  readonly groupId: string;
  readonly organizationId: string;
  readonly page: RecoveredPrincipalHistoryPage;
}): OrganizationGroupPolicyHistory {
  const { page } = input;
  return {
    groupId: input.groupId,
    organizationId: input.organizationId,
    principalId: input.groupId,
    principalType: "group",
    nextBeforeVersion: page.nextBeforeVersion,
    entries: page.entries
      .map((entry, index) => ({
        changes: diffPrincipalProjectionMembers({
          current: entry.projection,
          previous:
            (index === 0
              ? page.predecessor?.projection
              : page.entries[index - 1]?.projection) ?? [],
        }),
        createdAt: entry.state.createdAt,
        keyEpoch: entry.state.keyEpoch,
        memberCount: entry.state.memberCount,
        signedAt: entry.state.signedAt,
        signerUserId: entry.state.signerUserId,
        signerUserKeyFingerprint: entry.state.signerUserKeyFingerprint,
        stateHash: entry.state.stateHash,
        version: entry.state.version,
      }))
      .reverse(),
  };
}
