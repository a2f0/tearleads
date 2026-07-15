import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestTrustedUserIdentity } from "../../test/helpers/trustedUserIdentity";
import { createUserKeys } from "./userKeys";

test("user keys fetch verifies the returned signing public key fingerprint", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const logs: string[] = [];
  const signingKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const encapsulationKeyFingerprint = await toFingerprint(
    encapsulationKeyPair.publicKey,
  );
  const userKeys = createUserKeys({
    log: (message) => logs.push(message),
    resolveTrustedUserIdentity: async (userId) =>
      createTestTrustedUserIdentity({
        encapsulationKeyFingerprint,
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        signingKeyFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
        userId,
      }),
  });

  await expect(userKeys.fetch("user-1")).resolves.toEqual({
    encapsulationKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint,
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId: "user-1",
  });
  expect(logs).toEqual(["Loading user key for userId: user-1"]);
});

test("user keys fetch returns null when the trusted resolver has no identity", async () => {
  const logs: string[] = [];
  const userKeys = createUserKeys({
    log: (message) => logs.push(message),
    resolveTrustedUserIdentity: async () => null,
  });

  await expect(userKeys.fetch("user-1")).resolves.toBeNull();
  expect(logs).toEqual(["Loading user key for userId: user-1"]);
});

test("user keys fetch preserves typed identity integrity failures", async () => {
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Trusted user identity changed",
  );
  const userKeys = createUserKeys({
    log: () => undefined,
    resolveTrustedUserIdentity: async () => {
      throw mismatch;
    },
  });

  await expect(userKeys.fetch("user-1")).rejects.toBe(mismatch);
});
