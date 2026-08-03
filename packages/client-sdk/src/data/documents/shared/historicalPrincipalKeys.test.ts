import { expect, test } from "bun:test";
import {
  computeContainerKekMaterialId,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalPolicyHistoryEntryResponse,
  PrincipalPolicyHistoryResponse,
} from "@tearleads/validators/response";
import { MAX_PRINCIPAL_STATE_VERSION } from "@tearleads/validators/util";
import {
  openPrincipalWrapsThroughHistory,
  resolveHistoricalPrincipalKey,
} from "./historicalPrincipalKeys";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

async function memberEnvelopeFor(input: {
  principalSecret: Uint8Array;
  publicKey: Uint8Array;
}) {
  const [recipient] = await wrapDekForRecipients(input.principalSecret, [
    input.publicKey,
  ]);
  if (!recipient) throw new Error("expected a wrapped recipient");
  return {
    memberPrincipalType: "user" as const,
    memberPrincipalId: USER_ID,
    memberKeyFingerprint: recipient.keyFingerprint,
    kemCipherText: bytesToBase64(recipient.kemCipherText),
    wrappedKey: bytesToBase64(recipient.wrappedKey),
  };
}

/**
 * A well-formed signed-state header for one principal key epoch.
 *
 * Each epoch gets its own KEM keypair, so the state's `keyFingerprint`
 * genuinely matches its `encapsulationPublicKey` and its `stateHash` is the
 * real hash of its contents. Both are enforced — by the crypto layer and by
 * the walk respectively — so a hand-waved fixture would not survive either.
 */
async function stateAt(input: {
  prevStateHash: string | null;
  principalId?: string;
  publicKey: Uint8Array;
  /** Set only to forge a hash the state does not actually have. */
  stateHash?: string;
  version: number;
}) {
  const unsigned = {
    principalType: "group" as const,
    principalId: input.principalId ?? PRINCIPAL_ID,
    version: input.version,
    prevStateHash: input.prevStateHash,
    keyEpoch: input.version,
    encapsulationPublicKey: bytesToBase64(input.publicKey),
    keyFingerprint: await toFingerprint(input.publicKey),
    membershipMode: "projection" as const,
    membershipRoot: "root",
    memberEnvelopesRoot: "member-envelopes-root",
    projectionRoot: "projection-root",
    payloadCiphertextHash: "ciphertext-hash",
    memberCount: 1,
    externalAuthority: null,
    signedAt: "2026-01-01T00:00:00.000Z",
    signerUserId: "33333333-3333-4333-8333-333333333333",
    signerUserKeyFingerprint: "signer-fingerprint",
  };
  return {
    ...unsigned,
    signature: "signature",
    stateHash: input.stateHash ?? (await computePrincipalStateHash(unsigned)),
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function pageOf(
  entries: PrincipalPolicyHistoryEntryResponse[],
  hasMore = false,
): PrincipalPolicyHistoryResponse {
  return {
    principalType: "group",
    principalId: PRINCIPAL_ID,
    entries,
    hasMore,
  };
}

test("a removed member recovers the group key epoch their envelope was sealed to", async () => {
  const identity = generateKemSeedAndKeyPair();
  const epochOne = generateKemSeedAndKeyPair();
  const epochTwo = generateKemSeedAndKeyPair();
  const historicalSecret = crypto.getRandomValues(new Uint8Array(32));

  // Version 2 is CURRENT and carries no envelope for this user — they were
  // removed. Version 1 is the epoch a container envelope was sealed to, and
  // still holds their envelope, because a removal writes a NEW state rather
  // than rewriting the old one.
  const genesis = await stateAt({
    prevStateHash: null,
    publicKey: epochOne.publicKey,
    version: 1,
  });
  const history = pageOf([
    {
      state: await stateAt({
        prevStateHash: genesis.stateHash,
        publicKey: epochTwo.publicKey,
        version: 2,
      }),
      projection: [],
      memberEnvelopes: [],
    },
    {
      state: genesis,
      projection: [],
      memberEnvelopes: [
        await memberEnvelopeFor({
          principalSecret: historicalSecret,
          publicKey: identity.publicKey,
        }),
      ],
    },
  ]);

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () => history,
    keyFingerprint: genesis.keyFingerprint,
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).not.toBeNull();
  expect(Array.from(recovered ?? [])).toEqual(Array.from(historicalSecret));
});

test("a state whose claimed hash is not its real hash is rejected", async () => {
  const identity = generateKemSeedAndKeyPair();
  const epochOne = generateKemSeedAndKeyPair();
  const forgedSecret = crypto.getRandomValues(new Uint8Array(32));

  // Comparing the server's own prevStateHash against its own stateHash is
  // self-consistent for any fabricated pair. Recomputing the hash is what
  // makes the linkage mean anything.
  const forged = await stateAt({
    prevStateHash: null,
    publicKey: epochOne.publicKey,
    stateHash: "a-hash-this-state-does-not-have",
    version: 1,
  });

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () =>
      pageOf([
        {
          state: forged,
          projection: [],
          memberEnvelopes: [
            await memberEnvelopeFor({
              principalSecret: forgedSecret,
              publicKey: identity.publicKey,
            }),
          ],
        },
      ]),
    keyFingerprint: forged.keyFingerprint,
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
});

test("a broken predecessor link is rejected", async () => {
  const identity = generateKemSeedAndKeyPair();
  const epochOne = generateKemSeedAndKeyPair();
  const epochTwo = generateKemSeedAndKeyPair();
  const forgedSecret = crypto.getRandomValues(new Uint8Array(32));

  const genesis = await stateAt({
    prevStateHash: null,
    publicKey: epochOne.publicKey,
    version: 1,
  });
  // Its predecessor link does not name the state below it, so the chain does
  // not actually reach the genesis whose envelope is being offered.
  const orphan = await stateAt({
    prevStateHash: "not-the-state-below",
    publicKey: epochTwo.publicKey,
    version: 2,
  });

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () =>
      pageOf([
        { state: orphan, projection: [], memberEnvelopes: [] },
        {
          state: genesis,
          projection: [],
          memberEnvelopes: [
            await memberEnvelopeFor({
              principalSecret: forgedSecret,
              publicKey: identity.publicKey,
            }),
          ],
        },
      ]),
    keyFingerprint: genesis.keyFingerprint,
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
});

test("a page for the wrong principal yields no key", async () => {
  const identity = generateKemSeedAndKeyPair();
  const epochOne = generateKemSeedAndKeyPair();
  const genesis = await stateAt({
    prevStateHash: null,
    publicKey: epochOne.publicKey,
    version: 1,
  });

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async () => ({
      ...pageOf([{ state: genesis, projection: [], memberEnvelopes: [] }]),
      principalId: "44444444-4444-4444-8444-444444444444",
    }),
    keyFingerprint: genesis.keyFingerprint,
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
});

test("the walk stops instead of following an endless claim of more", async () => {
  const identity = generateKemSeedAndKeyPair();
  const epochOne = generateKemSeedAndKeyPair();
  let pages = 0;

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async (input) => {
      pages += 1;
      const version = (input.beforeVersion ?? MAX_PRINCIPAL_STATE_VERSION) - 1;
      return pageOf(
        [
          {
            state: await stateAt({
              prevStateHash: "unmatched",
              publicKey: epochOne.publicKey,
              version,
            }),
            projection: [],
            memberEnvelopes: [],
          },
        ],
        true,
      );
    },
    keyFingerprint: "never-matches-any-state",
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  expect(recovered).toBeNull();
  // Bounded: a server that always claims more cannot spin the walk forever.
  expect(pages).toBeGreaterThan(0);
  expect(pages).toBeLessThan(100);
});

test("a member reaches an outer group transitively through an inner one", async () => {
  const identity = generateKemSeedAndKeyPair();
  const outerEpoch = generateKemSeedAndKeyPair();
  const innerEpoch = generateKemSeedAndKeyPair();
  const outerSecret = crypto.getRandomValues(new Uint8Array(32));
  // A group's "secret key" IS its KEM secret: the outer envelope is sealed to
  // the inner group's PUBLIC key, so only that KEM secret opens it.
  const innerSecret = innerEpoch.secretKey;
  const innerGroupId = "55555555-5555-4555-8555-555555555555";

  // The outer group's envelope is addressed to the INNER group, not to the
  // user. Membership is transitive, so opening it means recovering the inner
  // group's key first — a hop the walk has to make on its own.
  const [innerRecipient] = await wrapDekForRecipients(outerSecret, [
    innerEpoch.publicKey,
  ]);
  if (!innerRecipient) throw new Error("expected the inner recipient");

  const outerGenesis = await stateAt({
    prevStateHash: null,
    publicKey: outerEpoch.publicKey,
    version: 1,
  });
  const innerGenesis = await stateAt({
    prevStateHash: null,
    principalId: innerGroupId,
    publicKey: innerEpoch.publicKey,
    version: 1,
  });

  const recovered = await resolveHistoricalPrincipalKey({
    fetchHistory: async (request) =>
      request.principalId === innerGroupId
        ? {
            principalType: "group",
            principalId: innerGroupId,
            hasMore: false,
            entries: [
              {
                state: innerGenesis,
                projection: [],
                memberEnvelopes: [
                  await memberEnvelopeFor({
                    principalSecret: innerSecret,
                    publicKey: identity.publicKey,
                  }),
                ],
              },
            ],
          }
        : pageOf([
            {
              state: outerGenesis,
              projection: [],
              memberEnvelopes: [
                {
                  memberPrincipalType: "group",
                  memberPrincipalId: innerGroupId,
                  memberKeyFingerprint: innerRecipient.keyFingerprint,
                  kemCipherText: bytesToBase64(innerRecipient.kemCipherText),
                  wrappedKey: bytesToBase64(innerRecipient.wrappedKey),
                },
              ],
            },
          ]),
    keyFingerprint: outerGenesis.keyFingerprint,
    principalId: PRINCIPAL_ID,
    principalType: "group",
    secretKey: identity.secretKey,
  });

  // Only the inner group's key opens the outer envelope, so recovering the
  // outer secret proves the hop happened.
  expect(recovered).not.toBeNull();
  expect(Array.from(recovered ?? [])).toEqual(Array.from(outerSecret));
});

test("a container envelope sealed to a historical group key is opened end to end", async () => {
  const identity = generateKemSeedAndKeyPair();
  const groupEpoch = generateKemSeedAndKeyPair();
  const containerId = crypto.randomUUID();
  const containerKey = crypto.getRandomValues(new Uint8Array(32));

  // The container envelope is KEM-wrapped to the GROUP's encapsulation key —
  // the same shape the server writes. Opening it needs decapsulation, not the
  // symmetric path a parent-container wrap uses, and this test exists because
  // that distinction is invisible until a real envelope is round-tripped.
  const [containerRecipient] = await wrapDekForRecipients(containerKey, [
    groupEpoch.publicKey,
  ]);
  if (!containerRecipient) throw new Error("expected a container recipient");

  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });

  const genesis = await stateAt({
    prevStateHash: null,
    publicKey: groupEpoch.publicKey,
    version: 1,
  });

  const recovered = await openPrincipalWrapsThroughHistory({
    containerId,
    containerKeyEpoch: 1,
    containerKeyEpochId,
    fetchHistory: async () =>
      pageOf([
        {
          state: genesis,
          projection: [],
          memberEnvelopes: [
            await memberEnvelopeFor({
              principalSecret: groupEpoch.secretKey,
              publicKey: identity.publicKey,
            }),
          ],
        },
      ]),
    principalWraps: [
      {
        containerKeyEpochId,
        recipientKind: "group",
        recipientId: PRINCIPAL_ID,
        recipientKeyEpochId: "epoch-1",
        recipientKeyFingerprint: containerRecipient.keyFingerprint,
        wrapManifestHash: "wrap-manifest-hash",
        kemCipherText: bytesToBase64(containerRecipient.kemCipherText),
        wrappedKey: bytesToBase64(containerRecipient.wrappedKey),
      },
    ],
    secretKey: identity.secretKey,
  });

  expect(recovered).not.toBeNull();
  expect(Array.from(recovered ?? [])).toEqual(Array.from(containerKey));
});
