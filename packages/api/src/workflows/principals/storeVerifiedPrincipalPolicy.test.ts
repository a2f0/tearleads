import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalStates, users } from "@tearleads/api-shared/schema";
import {
  AES_GCM_TAG_BYTES,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_KEM1024_CIPHERTEXT_BYTES,
  ML_KEM1024_SECRET_KEY_BYTES,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { and, eq } from "drizzle-orm";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { storeVerifiedPrincipalPolicyInTransaction } from "./storeVerifiedPrincipalPolicy";

async function createSigner() {
  const signing = generateSigningSeedAndKeyPair();
  const encapsulation = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signerUserKeyFingerprint = await toFingerprint(
    signing.signingPublicKey,
  );
  await db.insert(users).values({
    id: signerUserId,
    fingerprint: signerUserKeyFingerprint,
    signingPublicKey: bytesToBase64(signing.signingPublicKey),
    encapsulationPublicKey: bytesToBase64(encapsulation.publicKey),
    encapsulationKeyFingerprint: await toFingerprint(encapsulation.publicKey),
    defaultOrganizationId: crypto.randomUUID(),
  });
  return {
    encapsulationKeyFingerprint: await toFingerprint(encapsulation.publicKey),
    signerUserId,
    signerUserKeyFingerprint,
    ...signing,
  };
}

async function createChain() {
  const signer = await createSigner();
  const { publicKey } = generateKemSeedAndKeyPair();
  const principalId = crypto.randomUUID();
  const base = {
    principalType: "group" as const,
    principalId,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(publicKey),
    keyFingerprint: await toFingerprint(publicKey),
    members: [{ userId: signer.signerUserId }],
    projection: [{ userId: signer.signerUserId, role: "admin" as const }],
    memberEnvelopes: [
      {
        userId: signer.signerUserId,
        memberKeyFingerprint: signer.encapsulationKeyFingerprint,
        // Envelope verification checks shape and roots, not decryptability.
        kemCipherText: bytesToBase64(
          new Uint8Array(ML_KEM1024_CIPHERTEXT_BYTES),
        ),
        wrappedKey: bytesToBase64(
          new Uint8Array(ML_KEM1024_SECRET_KEY_BYTES + AES_GCM_TAG_BYTES),
        ),
      },
    ],
    payloadCiphertext: "ciphertext",
    signerUserId: signer.signerUserId,
    signerUserKeyFingerprint: signer.signerUserKeyFingerprint,
    signingPrivateKey: signer.signingPrivateKey,
  };
  const first = await signPrincipalStateBundle({
    ...base,
    version: 1,
    prevStateHash: null,
    signedAt: "2026-09-12T00:00:00.000Z",
  });
  const storedFirst = await db.transaction((tx) =>
    storeVerifiedPrincipalPolicyInTransaction(first, tx),
  );
  const second = await signPrincipalStateBundle({
    ...base,
    version: 2,
    prevStateHash: storedFirst.stateHash,
    signedAt: "2026-09-12T00:01:00.000Z",
  });
  return { principalId, second, storedFirst };
}

test("the stored bundle is re-verified from rows before a state commits", async () => {
  const { principalId, second, storedFirst } = await createChain();
  expect(storedFirst.version).toBe(1);
  const storedSecond = await db.transaction((tx) =>
    storeVerifiedPrincipalPolicyInTransaction(second, tx),
  );
  expect(storedSecond.version).toBe(2);
  expect(
    await getCurrentPrincipalState("group", principalId, db),
  ).toMatchObject({ stateHash: storedSecond.stateHash });
});

test("a stored predecessor that no longer verifies blocks its successor before commit", async () => {
  const { principalId, second, storedFirst } = await createChain();
  // Chain validation compares only the stored hash column, so a predecessor
  // whose row drifted from its signature (the #2278 M3 shape) would still be
  // accepted as the previous head; re-verifying from rows is what catches it.
  await db
    .update(principalStates)
    .set({ signature: second.state.signature })
    .where(
      and(
        eq(principalStates.principalId, principalId),
        eq(principalStates.version, 1),
      ),
    );
  await expect(
    db.transaction((tx) =>
      storeVerifiedPrincipalPolicyInTransaction(second, tx),
    ),
  ).rejects.toThrow("Stored principal policy failed integrity verification");
  expect(
    await getCurrentPrincipalState("group", principalId, db),
  ).toMatchObject({ stateHash: storedFirst.stateHash, version: 1 });
});
