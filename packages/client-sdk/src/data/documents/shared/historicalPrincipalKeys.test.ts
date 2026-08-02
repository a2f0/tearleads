import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyHistoryResponse } from "@tearleads/validators/response";
import { resolveHistoricalPrincipalKey } from "./historicalPrincipalKeys";

async function memberEnvelopeFor(input: {
  principalSecret: Uint8Array;
  publicKey: Uint8Array;
  userId: string;
}) {
  const [recipient] = await wrapDekForRecipients(input.principalSecret, [
    input.publicKey,
  ]);
  if (!recipient) throw new Error("expected a wrapped recipient");
  return {
    memberPrincipalType: "user" as const,
    memberPrincipalId: input.userId,
    memberKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
  };
}

function stateAt(input: {
  keyFingerprint: string;
  prevStateHash: string | null;
  stateHash: string;
  version: number;
}) {
  return {
    principalType: "group" as const,
    principalId: "11111111-1111-4111-8111-111111111111",
    version: input.version,
    prevStateHash: input.prevStateHash,
    keyEpoch: input.version,
    encapsulationPublicKey: "public-key",
    keyFingerprint: input.keyFingerprint,
    membershipMode: "projection" as const,
    membershipRoot: "root",
    memberEnvelopesRoot: "member-envelopes-root",
    projectionRoot: "projection-root",
    payloadCiphertextHash: "ciphertext-hash",
    memberCount: 1,
    externalAuthority: null,
    signedAt: "2026-01-01T00:00:00.000Z",
    signerUserId: "user-1",
    signerUserKeyFingerprint: "signer-fingerprint",
    signature: "signature",
    stateHash: input.stateHash,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

test("a removed member recovers the group key epoch their envelope was sealed to", async () => {
  const identity = generateKemSeedAndKeyPair();
  const historicalSecret = crypto.getRandomValues(new Uint8Array(32));
  const userId = "22222222-2222-4222-8222-222222222222";

  // Version 2 is the CURRENT state and carries no envelope for this user —
  // they were removed. Version 1 is the epoch a container envelope was sealed
  // to, and still holds their envelope, because removal writes a new state
  // rather than rewriting the old one.
  const history: PrincipalPolicyHistoryResponse = {
    principalType: "group",
    principalId: "11111111-1111-4111-8111-111111111111",
    hasMore: false,
    entries: [
      {
        state: stateAt({
          keyFingerprint: "fingerprint-2",
          prevStateHash: "state-hash-1",
          stateHash: "state-hash-2",
          version: 2,
        }),
        projection: [],
        memberEnvelopes: [],
      },
      {
        state: stateAt({
          keyFingerprint: "fingerprint-1",
          prevStateHash: null,
          stateHash: "state-hash-1",
          version: 1,
        }),
        projection: [],
        memberEnvelopes: [
          await memberEnvelopeFor({
            principalSecret: historicalSecret,
            publicKey: identity.publicKey,
            userId,
          }),
        ],
      },
    ],
  };

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () => history,
    keyFingerprint: "fingerprint-1",
    principalId: "11111111-1111-4111-8111-111111111111",
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).not.toBeNull();
  expect(Array.from(recovered ?? [])).toEqual(Array.from(historicalSecret));
});

test("a broken state chain yields no key", async () => {
  const identity = generateKemSeedAndKeyPair();
  const forgedSecret = crypto.getRandomValues(new Uint8Array(32));

  // The server serves a state whose predecessor link does not match the state
  // below it. Accepting it would let the server splice in a state carrying a
  // key of its choosing and have the client unwrap a container KEK under it.
  const history: PrincipalPolicyHistoryResponse = {
    principalType: "group",
    principalId: "11111111-1111-4111-8111-111111111111",
    hasMore: false,
    entries: [
      {
        state: stateAt({
          keyFingerprint: "fingerprint-2",
          prevStateHash: "not-the-state-below",
          stateHash: "state-hash-2",
          version: 2,
        }),
        projection: [],
        memberEnvelopes: [],
      },
      {
        state: stateAt({
          keyFingerprint: "fingerprint-1",
          prevStateHash: null,
          stateHash: "state-hash-1",
          version: 1,
        }),
        projection: [],
        memberEnvelopes: [
          await memberEnvelopeFor({
            principalSecret: forgedSecret,
            publicKey: identity.publicKey,
            userId: "22222222-2222-4222-8222-222222222222",
          }),
        ],
      },
    ],
  };

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () => history,
    keyFingerprint: "fingerprint-1",
    principalId: "11111111-1111-4111-8111-111111111111",
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
});

test("a page for the wrong principal yields no key", async () => {
  const identity = generateKemSeedAndKeyPair();
  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () => ({
      principalType: "group",
      principalId: "33333333-3333-4333-8333-333333333333",
      hasMore: false,
      entries: [
        {
          state: stateAt({
            keyFingerprint: "fingerprint-1",
            prevStateHash: null,
            stateHash: "state-hash-1",
            version: 1,
          }),
          projection: [],
          memberEnvelopes: [],
        },
      ],
    }),
    keyFingerprint: "fingerprint-1",
    principalId: "11111111-1111-4111-8111-111111111111",
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
});

test("the walk stops instead of following an endless claim of more", async () => {
  const identity = generateKemSeedAndKeyPair();
  let pages = 0;

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async (input) => {
      pages += 1;
      const version = (input.beforeVersion ?? 10_000) - 1;
      return {
        principalType: "group",
        principalId: "11111111-1111-4111-8111-111111111111",
        hasMore: true,
        entries: [
          {
            state: stateAt({
              keyFingerprint: `fingerprint-${version}`,
              prevStateHash: `state-hash-${version - 1}`,
              stateHash: `state-hash-${version}`,
              version,
            }),
            projection: [],
            memberEnvelopes: [],
          },
        ],
      };
    },
    keyFingerprint: "never-matches",
    principalId: "11111111-1111-4111-8111-111111111111",
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
  // Bounded, not unbounded: a hostile server cannot spin the walk forever.
  expect(pages).toBeLessThanOrEqual(64);
});
