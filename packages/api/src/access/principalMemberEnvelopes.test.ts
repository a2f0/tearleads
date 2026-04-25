import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { db } from "../adapters/postgres";
import { users } from "../schema";
import {
  listCurrentPrincipalMemberEnvelopes,
  listCurrentPrincipalMemberRecipients,
  replaceCurrentPrincipalMemberEnvelopes,
} from "./principalMemberEnvelopes";
import { storeVerifiedPrincipalState } from "./principalStateStore";

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
      memberPrincipalType: recipient.memberPrincipalType,
      memberPrincipalId: recipient.memberPrincipalId,
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
  const nestedGroupPrincipalId = crypto.randomUUID();

  const aliceKem = generateKemSeedAndKeyPair();
  const nestedGroupKem = generateKemSeedAndKeyPair();
  const groupKem = generateKemSeedAndKeyPair();

  const aliceSigner = await insertUserWithRecipientKey(
    aliceUserId,
    aliceKem.publicKey,
    { signingPrivateKey, signingPublicKey },
  );

  await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: nestedGroupPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(nestedGroupKem.publicKey),
        keyFingerprint: await toFingerprint(nestedGroupKem.publicKey),
        members: [
          {
            principalType: "user",
            principalId: aliceUserId,
          },
        ],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: aliceUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T12:00:00.000Z").toISOString(),
        signerUserId: aliceSigner.signerUserId,
        signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      },
      signingPrivateKey,
    ),
  );

  const storedState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: groupPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
        keyFingerprint: await toFingerprint(groupKem.publicKey),
        members: [
          {
            principalType: "user",
            principalId: aliceUserId,
          },
          {
            principalType: "group",
            principalId: nestedGroupPrincipalId,
          },
        ],
        projection: [
          {
            memberPrincipalType: "group",
            memberPrincipalId: nestedGroupPrincipalId,
            role: "member",
          },
          {
            memberPrincipalType: "user",
            memberPrincipalId: aliceUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T12:05:00.000Z").toISOString(),
        signerUserId: aliceSigner.signerUserId,
        signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      },
      signingPrivateKey,
    ),
  );

  const currentRecipients = await listCurrentPrincipalMemberRecipients(
    "group",
    groupPrincipalId,
  );
  const wrappedSecretEntries = await wrapDekForRecipients(
    crypto.getRandomValues(new Uint8Array(64)),
    currentRecipients.map((recipient) =>
      base64ToBytes(recipient.encapsulationPublicKey),
    ),
  );

  const storedEnvelopes = await replaceCurrentPrincipalMemberEnvelopes({
    principalType: "group",
    principalId: groupPrincipalId,
    stateHash: storedState.stateHash,
    envelopes: toMemberEnvelopeInputs(currentRecipients, wrappedSecretEntries),
  });

  expect(
    storedEnvelopes.map((envelope) => ({
      memberPrincipalType: envelope.memberPrincipalType,
      memberPrincipalId: envelope.memberPrincipalId,
      memberKeyFingerprint: envelope.memberKeyFingerprint,
      stateHash: envelope.stateHash,
      epoch: envelope.epoch,
    })),
  ).toEqual([
    {
      memberPrincipalType: "group",
      memberPrincipalId: nestedGroupPrincipalId,
      memberKeyFingerprint: await toFingerprint(nestedGroupKem.publicKey),
      stateHash: storedState.stateHash,
      epoch: 1,
    },
    {
      memberPrincipalType: "user",
      memberPrincipalId: aliceUserId,
      memberKeyFingerprint: await toFingerprint(aliceKem.publicKey),
      stateHash: storedState.stateHash,
      epoch: 1,
    },
  ]);

  const currentStoredEnvelopes = await listCurrentPrincipalMemberEnvelopes(
    "group",
    groupPrincipalId,
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

  const initialState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: groupPrincipalId,
        version: 1,
        prevStateHash: null,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
        keyFingerprint: await toFingerprint(groupKem.publicKey),
        members: [
          {
            principalType: "user",
            principalId: aliceUserId,
          },
        ],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: aliceUserId,
            role: "admin",
          },
        ],
        signedAt: new Date("2026-04-07T13:00:00.000Z").toISOString(),
        signerUserId: aliceSigner.signerUserId,
        signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      },
      signingPrivateKey,
    ),
  );

  const nextState = await storeVerifiedPrincipalState(
    await signPrincipalState(
      {
        principalType: "group",
        principalId: groupPrincipalId,
        version: 2,
        prevStateHash: initialState.stateHash,
        keyEpoch: 1,
        encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
        keyFingerprint: await toFingerprint(groupKem.publicKey),
        members: [
          {
            principalType: "user",
            principalId: aliceUserId,
          },
          {
            principalType: "user",
            principalId: bobUserId,
          },
        ],
        projection: [
          {
            memberPrincipalType: "user",
            memberPrincipalId: aliceUserId,
            role: "admin",
          },
          {
            memberPrincipalType: "user",
            memberPrincipalId: bobUserId,
            role: "member",
          },
        ],
        signedAt: new Date("2026-04-07T13:05:00.000Z").toISOString(),
        signerUserId: aliceSigner.signerUserId,
        signerUserKeyFingerprint: aliceSigner.signerUserKeyFingerprint,
      },
      signingPrivateKey,
    ),
  );

  const currentRecipients = await listCurrentPrincipalMemberRecipients(
    "group",
    groupPrincipalId,
  );
  const wrappedSecretEntries = await wrapDekForRecipients(
    crypto.getRandomValues(new Uint8Array(64)),
    currentRecipients.map((recipient) =>
      base64ToBytes(recipient.encapsulationPublicKey),
    ),
  );

  await expect(
    replaceCurrentPrincipalMemberEnvelopes({
      principalType: "group",
      principalId: groupPrincipalId,
      stateHash: initialState.stateHash,
      envelopes: toMemberEnvelopeInputs(
        currentRecipients,
        wrappedSecretEntries,
      ),
    }),
  ).rejects.toThrow("Principal member envelopes must target the current state");

  expect(nextState.keyEpoch).toBe(1);
});
