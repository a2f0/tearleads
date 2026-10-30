import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  KeyingVerificationError,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { identityLinkFixture } from "../../data/trustedUserIdentity/identityLink.testFixtures";
import { createUserIdentities } from "./userIdentities";

function unused(): never {
  throw new Error("unused");
}

test("resolveVerified returns only the identity the trust service verified", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const signingKeyFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const encapsulationKeyFingerprint = await toFingerprint(
    encapsulationKeyPair.publicKey,
  );
  const userIdentities = createUserIdentities({
    getOrganizationId: () => null,
    reportSecurityIncident: async () => {},
    identityLinks: {
      resolveVerified: async (userId) =>
        userId === "user-1"
          ? createTestTrustedUserIdentity({
              encapsulationKeyFingerprint,
              encapsulationPublicKey: encapsulationKeyPair.publicKey,
              signingKeyFingerprint,
              signingPublicKey: signingKeyPair.signingPublicKey,
              userId,
            })
          : null,
      createLink: async () => unused(),
      verifyLink: async () => unused(),
    },
  });

  await expect(userIdentities.resolveVerified("user-1")).resolves.toEqual({
    encapsulationKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    signingKeyFingerprint,
    signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
    userId: "user-1",
  });
  await expect(userIdentities.resolveVerified("user-2")).resolves.toBeNull();
});

test("the public surface offers no user-ID lookup that trusts on first use", () => {
  const userIdentities = createUserIdentities({
    getOrganizationId: () => null,
    reportSecurityIncident: async () => {},
    identityLinks: {
      resolveVerified: async () => null,
      createLink: async () => unused(),
      verifyLink: async () => unused(),
    },
  });

  expect(Object.keys(userIdentities).sort()).toEqual([
    "createLink",
    "resolveVerified",
    "verifyLink",
  ]);
});

test("verifyLink reports and preserves typed integrity failures", async () => {
  const mismatch = new KeyingVerificationError(
    "equivocation",
    "Trusted user identity changed",
  );
  const reported: string[] = [];
  const { link } = await identityLinkFixture();
  const userIdentities = createUserIdentities({
    getOrganizationId: () => null,
    reportSecurityIncident: async (_error, context) => {
      reported.push(context.operation);
    },
    identityLinks: {
      resolveVerified: async () => null,
      createLink: async () => unused(),
      verifyLink: async () => {
        throw mismatch;
      },
    },
  });

  await expect(userIdentities.verifyLink(link)).rejects.toBe(mismatch);
  expect(reported).toEqual(["user.identity.verify_link"]);
});
