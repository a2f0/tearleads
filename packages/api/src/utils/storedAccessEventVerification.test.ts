import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "@tearleads/crypto";
import { createContainerManifestFixture } from "@tearleads/crypto/test-fixtures";
import { verifyStoredAccessEvent } from "./storedAccessEventVerification";

test("a stored event binds its signature bytes and signer key", async () => {
  const signer = generateSigningSeedAndKeyPair();
  const manifest = await createContainerManifestFixture({
    signer,
    containerId: "signature-cache-container",
    directGrants: [],
  });
  const input = {
    stored: manifest.event,
    signerPublicKey: signer.signingPublicKey,
    error: (message: string) => new Error(message),
  };
  expect((await verifyStoredAccessEvent(input)).eventHash).toBe(
    manifest.event.eventHash,
  );
  const edited = structuredClone(manifest.event);
  Reflect.set(edited.event, "signedAt", "2026-09-28T00:00:00.000Z");
  await expect(
    verifyStoredAccessEvent({ ...input, stored: edited }),
  ).rejects.toThrow();
  await expect(
    verifyStoredAccessEvent({
      ...input,
      signerPublicKey: generateSigningSeedAndKeyPair().signingPublicKey,
    }),
  ).rejects.toThrow();
});

test("signature verification cannot bless a different claimed event hash", async () => {
  const signer = generateSigningSeedAndKeyPair();
  const manifest = await createContainerManifestFixture({
    signer,
    containerId: "signature-cache-container",
    directGrants: [],
  });
  await expect(
    verifyStoredAccessEvent({
      stored: { ...manifest.event, eventHash: "0".repeat(64) },
      signerPublicKey: signer.signingPublicKey,
      error: (message) => new Error(message),
    }),
  ).rejects.toThrow("access event hash is inconsistent");
});
