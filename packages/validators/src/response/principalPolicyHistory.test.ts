import { expect, test } from "bun:test";
import {
  PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT,
  PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT,
} from "../util";
import {
  isPrincipalPolicyHistoryEntryResponse,
  isPrincipalPolicyHistoryResponse,
} from "./principal";

function stateAtVersion(version: number) {
  return {
    principalType: "group",
    principalId: "group-123",
    version,
    prevStateHash: version === 1 ? null : `state-hash-${version - 1}`,
    keyEpoch: version,
    encapsulationPublicKey: "public-key",
    keyFingerprint: `fingerprint-${version}`,
    membershipMode: "projection",
    membershipRoot: "root",
    memberEnvelopesRoot: "member-envelopes-root",
    projectionRoot: "projection-root",
    payloadCiphertextHash: "ciphertext-hash",
    memberCount: 1,
    externalAuthority: null,
    signedAt: "2026-01-01T00:00:00.000Z",
    signerUserId: "user-1",
    signerUserKeyFingerprint: "policy-key-fingerprint-1",
    signature: "signature",
    stateHash: `state-hash-${version}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const envelope = {
  memberPrincipalType: "user",
  memberPrincipalId: "user-1",
  memberKeyFingerprint: "fingerprint",
  kemCipherText: "cipher",
  wrappedKey: "wrapped",
};

function entryAtVersion(version: number, envelopeCount = 1) {
  return {
    state: stateAtVersion(version),
    projection: [
      {
        memberPrincipalType: "user",
        memberPrincipalId: "user-1",
        role: "admin",
      },
    ],
    memberEnvelopes: Array.from({ length: envelopeCount }, () => envelope),
  };
}

function page(entries: unknown[], hasMore = false) {
  return {
    principalType: "group",
    principalId: "group-123",
    entries,
    hasMore,
  };
}

test("isPrincipalPolicyHistoryEntryResponse accepts a state with its envelopes", () => {
  expect(isPrincipalPolicyHistoryEntryResponse(entryAtVersion(3))).toBe(true);
  // Envelopes are what distinguish this from a plain chain entry; a missing
  // array is a chain entry, not a history entry.
  expect(
    isPrincipalPolicyHistoryEntryResponse({
      state: stateAtVersion(3),
      projection: [],
    }),
  ).toBe(false);
  expect(isPrincipalPolicyHistoryEntryResponse(null)).toBe(false);
});

test("isPrincipalPolicyHistoryEntryResponse bounds envelopes per state", () => {
  expect(
    isPrincipalPolicyHistoryEntryResponse(
      entryAtVersion(3, PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT),
    ),
  ).toBe(true);
  expect(
    isPrincipalPolicyHistoryEntryResponse(
      entryAtVersion(3, PRINCIPAL_POLICY_HISTORY_ENVELOPES_PER_STATE_LIMIT + 1),
    ),
  ).toBe(false);
});

test("isPrincipalPolicyHistoryResponse requires strictly descending versions", () => {
  expect(
    isPrincipalPolicyHistoryResponse(
      page([entryAtVersion(5), entryAtVersion(4), entryAtVersion(3)]),
    ),
  ).toBe(true);

  // Ascending would make the walk verify each state against the wrong
  // neighbour's prevStateHash.
  expect(
    isPrincipalPolicyHistoryResponse(
      page([entryAtVersion(3), entryAtVersion(4)]),
    ),
  ).toBe(false);

  // A repeated version re-applies a state the walk already verified.
  expect(
    isPrincipalPolicyHistoryResponse(
      page([entryAtVersion(4), entryAtVersion(4)]),
    ),
  ).toBe(false);
});

test("isPrincipalPolicyHistoryResponse bounds the page", () => {
  const atLimit = Array.from(
    { length: PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT },
    (_entry, index) =>
      entryAtVersion(PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT - index),
  );
  expect(isPrincipalPolicyHistoryResponse(page(atLimit))).toBe(true);

  const overLimit = Array.from(
    { length: PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT + 1 },
    (_entry, index) =>
      entryAtVersion(PRINCIPAL_POLICY_HISTORY_PAGE_LIMIT + 1 - index),
  );
  expect(isPrincipalPolicyHistoryResponse(page(overLimit))).toBe(false);
});

test("isPrincipalPolicyHistoryResponse requires the page envelope fields", () => {
  expect(
    isPrincipalPolicyHistoryResponse(page([entryAtVersion(1)], true)),
  ).toBe(true);
  expect(
    isPrincipalPolicyHistoryResponse({
      principalType: "group",
      principalId: "group-123",
      entries: [entryAtVersion(1)],
    }),
  ).toBe(false);
  expect(
    isPrincipalPolicyHistoryResponse({
      ...page([entryAtVersion(1)]),
      principalType: "user",
    }),
  ).toBe(false);
  expect(isPrincipalPolicyHistoryResponse(null)).toBe(false);
});
