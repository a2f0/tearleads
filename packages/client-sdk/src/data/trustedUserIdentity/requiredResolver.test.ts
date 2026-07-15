import { expect, test } from "bun:test";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { requireTrustedUserIdentityResolver } from "./requiredResolver";
import type { TrustedUserIdentity } from "./types";

test("resolver adapters are stable and idempotent", () => {
  const source = async () => null;
  const adapter = requireTrustedUserIdentityResolver(source);

  expect(requireTrustedUserIdentityResolver(source)).toBe(adapter);
  expect(requireTrustedUserIdentityResolver(adapter)).toBe(adapter);
});

test("resolver adapters reject structurally forged identity values", async () => {
  const forged = {
    encapsulationKeyFingerprint: "encapsulation-fingerprint",
    encapsulationPublicKey: new Uint8Array(),
    identityTrustDomain: "https://api.example.test",
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: new Uint8Array(),
    userId: "user-1",
  } as unknown as TrustedUserIdentity;
  const resolver = requireTrustedUserIdentityResolver(async () => forged);

  await expect(resolver("user-1")).rejects.toMatchObject({
    code: "invalid_shape",
  });
});

test("resolver adapters enforce the requested user binding", async () => {
  const identity = createTestTrustedUserIdentity({
    signingKeyFingerprint: "signing-fingerprint",
    signingPublicKey: new Uint8Array(),
    userId: "user-2",
  });
  const resolver = requireTrustedUserIdentityResolver(async () => identity);

  await expect(resolver("user-1")).rejects.toMatchObject({
    code: "object_mismatch",
  });
});
