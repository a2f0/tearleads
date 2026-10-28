import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type { PrincipalPolicyStateChainEntryResponse } from "@tearleads/validators/response";
import type { OrganizationLeaveRequest } from "@tearleads/validators/util";
import type { RecoveredPrincipalHistoryPage } from "../../principals/historyRecovery/loadRecoveredPrincipalHistoryPage";
import {
  createLeaveRequestMembershipCheck,
  type LeaveRequestMembershipEvidence,
} from "./leaveRequestMembership";

const MEMBERS_ID = "4e5f6a7b-8c9d-4e0f-8a1b-2c3d4e5f6a7b";
const ADMIN = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d";
const MEMBER = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const COLLEAGUE = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

function entry(
  version: number,
  keyEpoch: number,
  userIds: readonly string[],
  keyFingerprint = `members-key-${keyEpoch}`,
): PrincipalPolicyStateChainEntryResponse {
  return {
    grants: [],
    projection: userIds.map((userId) => ({ role: "member", userId })),
    state: {
      createdAt: "2026-10-22T12:00:00.000Z",
      encapsulationPublicKey: `members-kem-${keyEpoch}`,
      externalAuthority: null,
      grantCount: 0,
      grantRoot: "grants",
      keyEpoch,
      keyFingerprint,
      memberCount: userIds.length,
      memberEnvelopesRoot: "envelopes",
      membershipMode: "projection",
      membershipRoot: "membership",
      payloadCiphertextHash: "payload",
      prevStateHash: version === 1 ? null : `members-state-${version - 1}`,
      principalId: MEMBERS_ID,
      principalType: "group",
      projectionRoot: "projection",
      signature: "signature",
      signedAt: "2026-10-22T12:00:00.000Z",
      signerUserId: ADMIN,
      signerUserKeyFingerprint: "admin-key",
      stateHash: `members-state-${version}`,
      version,
    },
  };
}

// The member asks, a colleague joins and is removed, then the member is
// removed and later added back.
const HISTORY = [
  entry(1, 1, [ADMIN, MEMBER]),
  entry(2, 1, [ADMIN, MEMBER, COLLEAGUE]),
  entry(3, 2, [ADMIN, MEMBER]),
  entry(4, 3, [ADMIN]),
  entry(5, 3, [ADMIN, MEMBER]),
];

function headAt(
  version: number,
  history: readonly PrincipalPolicyStateChainEntryResponse[] = HISTORY,
): ReferencedPrincipalHead {
  const state = history[version - 1]?.state;
  if (!state) throw new Error("No such Members state");
  return {
    keyEpoch: state.keyEpoch,
    keyFingerprint: state.keyFingerprint,
    principalId: state.principalId,
    principalType: "group",
    stateHash: state.stateHash,
    version: state.version,
  };
}

function requestCiting(
  version: number,
  history: readonly PrincipalPolicyStateChainEntryResponse[] = HISTORY,
): OrganizationLeaveRequest {
  const { principalType: _principalType, ...membersHead } = headAt(
    version,
    history,
  );
  return {
    membersHead,
    organizationId: "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b",
    requestedAt: "2026-10-22T12:00:00.000Z",
    signature: "signature",
    userId: MEMBER,
  };
}

// Verified history pages of `pageSize` states, as the paged verifier serves
// them: ascending, ending just below `beforeVersion`.
function historyPages(
  history: readonly PrincipalPolicyStateChainEntryResponse[],
  pageSize: number,
  served: number[] = [],
): NonNullable<LeaveRequestMembershipEvidence["loadHistoryPage"]> {
  return async (head, beforeVersion = head.version + 1) => {
    served.push(beforeVersion);
    const entries = history
      .filter((candidate) => candidate.state.version < beforeVersion)
      .slice(-pageSize);
    const first = entries[0]?.state.version ?? 1;
    const page: RecoveredPrincipalHistoryPage = {
      entries,
      nextBeforeVersion: first > 1 ? first : null,
      predecessor: null,
    };
    return page;
  };
}

function checkAt(
  version: number,
  loadHistoryPage: LeaveRequestMembershipEvidence["loadHistoryPage"] = historyPages(
    HISTORY.slice(0, version),
    2,
  ),
) {
  return createLeaveRequestMembershipCheck({
    loadHistoryPage,
    loadMembersHead: async () => headAt(version),
  });
}

test("a request citing the current key epoch needs no history", async () => {
  const served: number[] = [];
  const check = checkAt(5, historyPages(HISTORY, 2, served));
  expect(await check(requestCiting(5))).toBe(true);
  expect(served).toEqual([]);
});

test("a request from before the member's removal is refused after they rejoin", async () => {
  // The server re-serves the member's genuine request from their first
  // membership. History shows the removal at version 4.
  expect(await checkAt(5)(requestCiting(2))).toBe(false);
  expect(await checkAt(5)(requestCiting(1))).toBe(false);
});

test("another member's removal does not end a request", async () => {
  // Version 3 removed the colleague and rotated the key; the member stayed.
  expect(await checkAt(3)(requestCiting(1))).toBe(true);
  expect(await checkAt(3)(requestCiting(2))).toBe(true);
});

test("history is walked across pages back to the cited state", async () => {
  const served: number[] = [];
  const check = checkAt(3, historyPages(HISTORY.slice(0, 3), 1, served));
  expect(await check(requestCiting(1))).toBe(true);
  expect(served).toEqual([4, 3, 2]);
});

test("a request this device cannot place is not shown", async () => {
  // No verified Members head, a later epoch than this device has verified, no
  // way to read history, or history that fails to load.
  expect(
    await createLeaveRequestMembershipCheck({
      loadMembersHead: async () => null,
    })(requestCiting(5)),
  ).toBe(false);
  expect(await checkAt(3)(requestCiting(5))).toBe(false);
  expect(
    await createLeaveRequestMembershipCheck({
      loadMembersHead: async () => headAt(3),
    })(requestCiting(1)),
  ).toBe(false);
  expect(
    await checkAt(3, async () => {
      throw new Error("offline");
    })(requestCiting(1)),
  ).toBe(false);
});

test("the cited state must be the one in verified history", async () => {
  const forged = requestCiting(1);
  expect(
    await checkAt(3)({
      ...forged,
      membersHead: { ...forged.membersHead, stateHash: "members-state-x" },
    }),
  ).toBe(false);
  expect(
    await checkAt(3)({
      ...forged,
      membersHead: { ...forged.membersHead, principalId: ADMIN },
    }),
  ).toBe(false);
});

test("history that skips a version or ends elsewhere proves nothing", async () => {
  const gapped = [HISTORY[0], HISTORY[2]].filter(
    (candidate) => candidate !== undefined,
  );
  expect(await checkAt(3, historyPages(gapped, 4))(requestCiting(1))).toBe(
    false,
  );
  const otherHead = [
    ...HISTORY.slice(0, 2),
    {
      ...entry(3, 2, [ADMIN, MEMBER]),
      state: { ...entry(3, 2, []).state, stateHash: "fork" },
    },
  ];
  expect(await checkAt(3, historyPages(otherHead, 4))(requestCiting(1))).toBe(
    false,
  );
});

test("a request from another fork of Members history is refused", async () => {
  // Two signed successors of version 1 both rotate to epoch 2, with different
  // keys. The member asked on the fork that removed the colleague; this
  // device follows the fork that removed and re-added the member.
  const asked = [
    entry(1, 1, [ADMIN, MEMBER, COLLEAGUE]),
    entry(2, 2, [ADMIN, MEMBER], "fork-a"),
  ];
  const followed = [
    entry(1, 1, [ADMIN, MEMBER, COLLEAGUE]),
    entry(2, 2, [ADMIN, COLLEAGUE], "fork-b"),
    entry(3, 2, [ADMIN, MEMBER, COLLEAGUE], "fork-b"),
  ];
  const check = createLeaveRequestMembershipCheck({
    loadHistoryPage: historyPages(followed, 4),
    loadMembersHead: async () => headAt(3, followed),
  });
  expect(await check(requestCiting(2, asked))).toBe(false);
  expect(await check(requestCiting(3, followed))).toBe(true);
});
