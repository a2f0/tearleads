import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  verifySignedPrincipalStateResult,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  signPrincipalStateBundle,
  storePrincipalState,
} from "../../../test/helpers/principalState";
import { registerUser } from "../../../test/helpers/registerUser";
import { assertStoredPrincipalStateVerbatim } from "../shared/internal/principalStateSignature";

test("principal state identities cannot change during storage", async () => {
  const signer = {
    ...createTestUser(),
    userId: `a${crypto.randomUUID().slice(1)}`,
  };
  await registerUser(signer);
  const { publicKey } = generateKemSeedAndKeyPair();
  const input = await signPrincipalStateBundle({
    principalType: "group",
    principalId: `b${crypto.randomUUID().slice(1)}`,
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(publicKey),
    keyFingerprint: await toFingerprint(publicKey),
    members: [{ userId: signer.userId }],
    projection: [{ userId: signer.userId, role: "admin" }],
    payloadCiphertext: "payload",
    signedAt: "2026-09-25T00:00:00.000Z",
    signerUserId: signer.userId,
    signerUserKeyFingerprint: signer.fingerprint,
    signingPrivateKey: signer.signing.signingPrivateKey,
  });
  for (const field of ["principalId", "signerUserId"] as const) {
    const state = await signPrincipalState(
      { ...input.state, [field]: input.state[field].toUpperCase() },
      signer.signing.signingPrivateKey,
    );
    await expect(
      storePrincipalState({ ...input, state }, db),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  }
  const stored = await storePrincipalState(input, db);
  expect(
    (
      await verifySignedPrincipalStateResult(
        stored,
        signer.signing.signingPublicKey,
      )
    ).ok,
  ).toBe(true);
  const stateHash = await computePrincipalStateHash(input.state);
  await expect(
    assertStoredPrincipalStateVerbatim(stored, input.state, stateHash),
  ).resolves.toBeUndefined();
  for (const signedAt of [
    "2026-09-25T00:00:00.001Z",
    "2026-09-25T01:00:00.000Z",
  ]) {
    await expect(
      assertStoredPrincipalStateVerbatim(
        { ...stored, signedAt },
        input.state,
        stateHash,
      ),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  }
});
