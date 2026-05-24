import { expect, test } from "bun:test";
import type { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTearleadsUserKeys } from "./userKeys";

test("user keys fetch verifies the returned signing public key fingerprint", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const logs: string[] = [];
  const userKeys = createTearleadsUserKeys({
    apiClient: {
      getEncapsulationKey: async (userId: string) => ({
        encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
        signingKeyFingerprint: await toFingerprint(
          signingKeyPair.signingPublicKey,
        ),
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        userId,
      }),
    } as unknown as ApiClient,
    log: (message) => logs.push(message),
  });

  await expect(userKeys.fetch("user-1")).resolves.toEqual({
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId: "user-1",
  });
  expect(logs).toEqual(["Loading user key for userId: user-1"]);
});

test("user keys fetch skips mismatched responses", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const logs: string[] = [];
  const userKeys = createTearleadsUserKeys({
    apiClient: {
      getEncapsulationKey: async () => ({
        encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
        signingKeyFingerprint: "0".repeat(64),
        signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
        userId: "other-user",
      }),
    } as unknown as ApiClient,
    log: (message) => logs.push(message),
  });

  await expect(userKeys.fetch("user-1")).resolves.toBeNull();
  expect(logs).toContain(
    "Skipped user key for user-1 because the signing fingerprint does not match the public key.",
  );
});
