import { expect, test } from "bun:test";
import { db } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
import {
  signPrincipalStateBundle,
  storePrincipalState as storeVerifiedPrincipalState,
} from "../../../test/helpers/principalState";
import { replacePrincipalMemberEnvelopesInTestTransaction as replaceCurrentPrincipalMemberEnvelopes } from "../../../test/helpers/principalStateTransactions";
import {
  listCurrentPrincipalMemberEnvelopes,
  type listCurrentPrincipalMemberRecipients,
} from "../read/principalMemberEnvelopes";

async function insertUserWithRecipientKey(
  userId: string,
  publicKey: Uint8Array,
  signingKeys: ReturnType<
    typeof generateSigningSeedAndKeyPair
  > = generateSigningSeedAndKeyPair(),
) {
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);

  await db.insert(users).values({
    id: userId,
    fingerprint,
    signingPublicKey: bytesToBase64(signingKeys.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(publicKey),
    encapsulationKeyFingerprint: await toFingerprint(publicKey),
    defaultOrganizationId: crypto.randomUUID(),
  });

  return {
    ...signingKeys,
    signerUserId: userId,
    signerUserKeyFingerprint: fingerprint,
  };
}

function toMemberEnvelopeInputs(
  recipients: Awaited<ReturnType<typeof listCurrentPrincipalMemberRecipients>>,
  wrappedSecretEntries: Awaited<ReturnType<typeof wrapDekForRecipients>>,
) {
  return recipients.map((recipient, index) => {
    const wrappedSecretEntry = wrappedSecretEntries[index];

    if (!wrappedSecretEntry) {
      throw new Error("Missing wrapped secret entry for principal member");
    }

    return {
      userId: recipient.userId,
      memberKeyFingerprint: recipient.memberKeyFingerprint,
      kemCipherText: bytesToBase64(wrappedSecretEntry.kemCipherText),
      wrappedKey: bytesToBase64(wrappedSecretEntry.wrappedKey),
    };
  });
}

test("replaceCurrentPrincipalMemberEnvelopes stores the current direct member wraps for a principal state", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const aliceUserId = crypto.randomUUID();
  const groupPrincipalId = crypto.randomUUID();
  const bobUserId = crypto.randomUUID();

  const aliceKem = generateKemSeedAndKeyPair();
  const bobKem = generateKemSeedAndKeyPair();
  const groupKem = generateKemSeedAndKeyPair();

  const aliceSigner = await insertUserWithRecipientKey(
    aliceUserId,
    aliceKem.publicKey,
    { signingPrivateKey, signingPublicKey },
  );
  // Bob is an ordinary second user. This block used to stand up a nested group
  // principal and make it a member; principals contain only users now.
  // His own signing keypair: the users table enforces a unique fingerprint.
  await insertUserWithRecipientKey(
    bobUserId,
    bobKem.publicKey,
    generateSigningSeedAndKeyPair(),
  );

  const groupMembers = [{ userId: aliceUserId }, { userId: bobUserId }];
  const groupProjection = [
    {
      userId: bobUserId,
      role: "member" as const,
    },
    {
      userId: aliceUserId,
      role: "admin" as const,
    },
  ];
  const wrappedSecretEntries = await wrapDekForRecipients(groupKem.secretKey, [
    bobKem.publicKey,
    aliceKem.publicKey,
  ]);
  const memberEnvelopes = toMemberEnvelopeInputs(
    [
      {
        userId: bobUserId,
        memberKeyFingerprint: await toFingerprint(bobKem.publicKey),
        encapsulationPublicKey: bytesToBase64(bobKem.publicKey),
      },
      {
        userId: aliceUserId,
        memberKeyFingerprint: await toFingerprint(aliceKem.publicKey),
        encapsulationPublicKey: bytesToBase64(aliceKem.publicKey),
      },
    ],
    wrappedSecretEntries,
  );
  const storedState = await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: "group",
      principalId: groupPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: groupMembers,
      memberEnvelopes,
      projection: groupProjection,
      payloadCiphertext: JSON.stringify({ members: groupProjection }),
      signedAt: new Date("2026-04-07T12:05:00.000Z").toISOString(),
      signerUserId: aliceSigner.signerUserId,
      signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      signingPrivateKey,
    }),
    db,
  );

  const storedEnvelopes = await replaceCurrentPrincipalMemberEnvelopes(
    {
      principalType: "group",
      principalId: groupPrincipalId,
      stateHash: storedState.stateHash,
      envelopes: memberEnvelopes,
    },
    db,
  );

  // Envelopes come back ordered by user id. That used to be a two-level sort on
  // (member kind, id) which put a user member first regardless of its random
  // uuid; with only users left, the ids alone decide, so the expectation has to
  // sort the same way rather than pin an insertion order.
  expect(
    storedEnvelopes.map((envelope) => ({
      userId: envelope.userId,
      memberKeyFingerprint: envelope.memberKeyFingerprint,
      stateHash: envelope.stateHash,
      epoch: envelope.epoch,
    })),
  ).toEqual(
    [
      {
        userId: bobUserId,
        memberKeyFingerprint: await toFingerprint(bobKem.publicKey),
        stateHash: storedState.stateHash,
        epoch: 1,
      },
      {
        userId: aliceUserId,
        memberKeyFingerprint: await toFingerprint(aliceKem.publicKey),
        stateHash: storedState.stateHash,
        epoch: 1,
      },
    ].sort((left, right) => (left.userId < right.userId ? -1 : 1)),
  );

  const currentStoredEnvelopes = await listCurrentPrincipalMemberEnvelopes(
    "group",
    groupPrincipalId,
    db,
  );
  expect(currentStoredEnvelopes).toHaveLength(2);
});

test("replaceCurrentPrincipalMemberEnvelopes rejects stale state hashes even when the principal epoch is unchanged", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const groupPrincipalId = crypto.randomUUID();
  const aliceUserId = crypto.randomUUID();
  const bobUserId = crypto.randomUUID();
  const groupKem = generateKemSeedAndKeyPair();
  const aliceKem = generateKemSeedAndKeyPair();
  const bobKem = generateKemSeedAndKeyPair();

  const aliceSigner = await insertUserWithRecipientKey(
    aliceUserId,
    aliceKem.publicKey,
    { signingPrivateKey, signingPublicKey },
  );
  await insertUserWithRecipientKey(bobUserId, bobKem.publicKey);

  const initialMembers = [{ userId: aliceUserId }];
  const initialProjection = [
    {
      userId: aliceUserId,
      role: "admin" as const,
    },
  ];
  const [initialWrappedSecretEntry] = await wrapDekForRecipients(
    groupKem.secretKey,
    [aliceKem.publicKey],
  );
  if (!initialWrappedSecretEntry) {
    throw new Error("Missing initial wrapped group key");
  }
  const initialMemberEnvelopes = [
    {
      userId: aliceUserId,
      memberKeyFingerprint: await toFingerprint(aliceKem.publicKey),
      kemCipherText: bytesToBase64(initialWrappedSecretEntry.kemCipherText),
      wrappedKey: bytesToBase64(initialWrappedSecretEntry.wrappedKey),
    },
  ];
  const initialState = await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: "group",
      principalId: groupPrincipalId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: initialMembers,
      memberEnvelopes: initialMemberEnvelopes,
      projection: initialProjection,
      payloadCiphertext: JSON.stringify({ members: initialProjection }),
      signedAt: new Date("2026-04-07T13:00:00.000Z").toISOString(),
      signerUserId: aliceSigner.signerUserId,
      signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      signingPrivateKey,
    }),
    db,
  );

  const nextMembers = [{ userId: aliceUserId }, { userId: bobUserId }];
  const nextProjection = [
    {
      userId: aliceUserId,
      role: "admin" as const,
    },
    {
      userId: bobUserId,
      role: "member" as const,
    },
  ];
  const nextWrappedSecretEntries = await wrapDekForRecipients(
    groupKem.secretKey,
    [aliceKem.publicKey, bobKem.publicKey],
  );
  const nextMemberEnvelopes = toMemberEnvelopeInputs(
    [
      {
        userId: aliceUserId,
        memberKeyFingerprint: await toFingerprint(aliceKem.publicKey),
        encapsulationPublicKey: bytesToBase64(aliceKem.publicKey),
      },
      {
        userId: bobUserId,
        memberKeyFingerprint: await toFingerprint(bobKem.publicKey),
        encapsulationPublicKey: bytesToBase64(bobKem.publicKey),
      },
    ],
    nextWrappedSecretEntries,
  );
  const nextState = await storeVerifiedPrincipalState(
    await signPrincipalStateBundle({
      principalType: "group",
      principalId: groupPrincipalId,
      version: 2,
      prevStateHash: initialState.stateHash,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: nextMembers,
      memberEnvelopes: nextMemberEnvelopes,
      projection: nextProjection,
      payloadCiphertext: JSON.stringify({ members: nextProjection }),
      signedAt: new Date("2026-04-07T13:05:00.000Z").toISOString(),
      signerUserId: aliceSigner.signerUserId,
      signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      signingPrivateKey,
    }),
    db,
  );

  await expect(
    replaceCurrentPrincipalMemberEnvelopes(
      {
        principalType: "group",
        principalId: groupPrincipalId,
        stateHash: initialState.stateHash,
        envelopes: nextMemberEnvelopes,
      },
      db,
    ),
  ).rejects.toThrow("Principal member envelopes must target the current state");

  expect(nextState.keyEpoch).toBe(1);
});
