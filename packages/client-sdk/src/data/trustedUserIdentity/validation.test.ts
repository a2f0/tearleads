import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  ML_DSA87_PUBLIC_KEY_BYTES,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import {
  isTrustedUserIdentity,
  type RemoteUserIdentityCandidate,
} from "./types";
import { validateRemoteUserIdentity } from "./validation";

const USER_ID = "11111111-1111-4111-8111-111111111111";

async function createRemoteCandidate(): Promise<RemoteUserIdentityCandidate> {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  return {
    encapsulationKeyFingerprint: await toFingerprint(
      encapsulationKeyPair.publicKey,
    ),
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId: USER_ID,
  };
}

test("remote identity rejects response and request user mismatches", async () => {
  const candidate = await createRemoteCandidate();

  await expect(
    validateRemoteUserIdentity({
      candidate: { ...candidate, userId: crypto.randomUUID() },
      identityTrustDomain: "https://api.example.test/v1",
      requestedUserId: USER_ID,
    }),
  ).rejects.toMatchObject({ code: "object_mismatch" });
  await expect(
    validateRemoteUserIdentity({
      candidate,
      identityTrustDomain: "https://api.example.test/v1",
      requestedUserId: "not-a-uuid",
    }),
  ).rejects.toMatchObject({ code: "invalid_shape" });
});

test("remote identity requires canonical base64 and exact key lengths", async () => {
  const candidate = await createRemoteCandidate();

  await expect(
    validateRemoteUserIdentity({
      candidate: {
        ...candidate,
        encapsulationPublicKey: candidate.encapsulationPublicKey.replace(
          /=$/u,
          "",
        ),
      },
      identityTrustDomain: "https://api.example.test/v1",
      requestedUserId: USER_ID,
    }),
  ).rejects.toMatchObject({ code: "invalid_shape" });
  await expect(
    validateRemoteUserIdentity({
      candidate: {
        ...candidate,
        signingPublicKey: bytesToBase64(
          new Uint8Array(ML_DSA87_PUBLIC_KEY_BYTES - 1),
        ),
      },
      identityTrustDomain: "https://api.example.test/v1",
      requestedUserId: USER_ID,
    }),
  ).rejects.toMatchObject({ code: "invalid_shape" });
});

test("remote identity recomputes and checks both supplied fingerprints", async () => {
  const candidate = await createRemoteCandidate();

  for (const changed of [
    { ...candidate, signingKeyFingerprint: "0".repeat(64) },
    { ...candidate, encapsulationKeyFingerprint: "0".repeat(64) },
  ]) {
    await expect(
      validateRemoteUserIdentity({
        candidate: changed,
        identityTrustDomain: "https://api.example.test/v1",
        requestedUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
  }
});

test("shape validation alone does not mint the durable trust capability", async () => {
  const candidate = await createRemoteCandidate();
  const validated = await validateRemoteUserIdentity({
    candidate,
    identityTrustDomain: "https://api.example.test/v1",
    requestedUserId: USER_ID,
  });

  expect(isTrustedUserIdentity(validated)).toBe(false);
});
