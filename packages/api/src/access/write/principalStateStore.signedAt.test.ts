import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  PrincipalPolicyValidationError,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  signPrincipalStateBundle,
  storePrincipalState,
} from "../../../test/helpers/principalState";

async function createSignedState(signedAt: string) {
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
  const { publicKey } = generateKemSeedAndKeyPair();
  return signPrincipalStateBundle({
    principalType: "group",
    principalId: crypto.randomUUID(),
    version: 1,
    prevStateHash: null,
    keyEpoch: 1,
    encapsulationPublicKey: bytesToBase64(publicKey),
    keyFingerprint: await toFingerprint(publicKey),
    members: [{ userId: signerUserId }],
    projection: [{ userId: signerUserId, role: "admin" }],
    payloadCiphertext: "ciphertext",
    signedAt,
    signerUserId,
    signerUserKeyFingerprint,
    signingPrivateKey: signing.signingPrivateKey,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the store to reject");
}

test("range-boundary timestamps are stored and served verbatim", async () => {
  for (const signedAt of [
    "1970-01-01T00:00:00.000Z",
    "9999-12-31T23:59:59.999Z",
  ]) {
    const bundle = await createSignedState(signedAt);
    const stored = await storePrincipalState(bundle, db);
    expect(stored.signedAt).toBe(signedAt);
  }
});

test("a header the reader cannot encode is a typed shape rejection, not an unauthorized signer", async () => {
  const bundle = await createSignedState("2026-09-12T00:00:00.000Z");
  for (const signedAt of [
    "0050-01-01T00:00:00.000Z",
    "+010000-01-01T00:00:00.000Z",
    "2026-09-12T00:00:00Z",
  ]) {
    const failure = await failureOf(
      storePrincipalState(
        { ...bundle, state: { ...bundle.state, signedAt } },
        db,
      ),
    );
    expect(failure).toBeInstanceOf(PrincipalPolicyValidationError);
    expect(failure).toMatchObject({
      code: "invalid_shape",
      message: expect.stringContaining("Principal state is malformed"),
    });
  }
});

test("a well-formed header with the wrong signature stays an unauthorized signer", async () => {
  const bundle = await createSignedState("2026-09-12T00:00:00.000Z");
  const other = await createSignedState("2026-09-12T00:00:00.000Z");
  const failure = await failureOf(
    storePrincipalState(
      {
        ...bundle,
        state: { ...bundle.state, signature: other.state.signature },
      },
      db,
    ),
  );
  expect(failure).toMatchObject({
    code: "unauthorized_signer",
    message: "Invalid principal state signature",
  });
});
