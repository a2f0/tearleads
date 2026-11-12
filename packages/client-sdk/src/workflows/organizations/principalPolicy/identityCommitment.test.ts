import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { buildOrganizationProvisioningArtifacts } from "../../registration/organizationProvisioning";
import { buildInitialGroupPolicyRequest } from "./principalPolicyRequest";

const identityTrustDomain = "https://identity.example.test";

test("initial policy commits the complete domain-scoped identity-link tuple before a pin exists", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const expected = await toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([
        "tearleads.identity-link.v1",
        identityTrustDomain,
        signerUserId,
        "ML-DSA-87",
        bytesToBase64(signingKeyPair.signingPublicKey),
        "ML-KEM-1024",
        bytesToBase64(creatorEncapsulationKeyPair.publicKey),
      ]),
    ),
  );
  const request = await buildInitialGroupPolicyRequest({
    identityTrustDomain,
    creatorEncapsulationKeyPair,
    signerUserId,
    signingKeyPair,
    signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    groupId: crypto.randomUUID(),
    name: "Members",
    builtinRole: "members",
  });
  expect(
    request.initialGroupPolicy.projection[0]?.identityBundleFingerprint,
  ).toBe(expected);
  expect(request.initialGroupPolicy.memberEnvelopes[0]).not.toHaveProperty(
    "identityBundleFingerprint",
  );
});

test("policy writers refuse an absent deployment domain instead of committing null", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorEncapsulationKeyPair = generateKemSeedAndKeyPair();
  const input = {
    identityTrustDomain,
    creatorEncapsulationKeyPair,
    signerUserId: crypto.randomUUID(),
    signingKeyPair,
    signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    groupId: crypto.randomUUID(),
    name: "Members",
    builtinRole: "members" as const,
  };
  Reflect.deleteProperty(input, "identityTrustDomain");
  await expect(buildInitialGroupPolicyRequest(input)).rejects.toThrow(
    "trust domain",
  );
});

test("registration provisioning commits one real identity in all founding principals", async () => {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const encapsulationKeyPair = generateKemSeedAndKeyPair();
  const userId = crypto.randomUUID();
  const artifacts = await buildOrganizationProvisioningArtifacts({
    identityTrustDomain,
    signingKeyPair,
    encapsulationKeyPair,
    userId,
    rootContainerId: crypto.randomUUID(),
  });
  const expected = await toFingerprint(
    new TextEncoder().encode(
      JSON.stringify([
        "tearleads.identity-link.v1",
        identityTrustDomain,
        userId,
        "ML-DSA-87",
        bytesToBase64(signingKeyPair.signingPublicKey),
        "ML-KEM-1024",
        bytesToBase64(encapsulationKeyPair.publicKey),
      ]),
    ),
  );
  for (const policy of [
    artifacts.initialAdminGroup.initialGroupPolicy,
    artifacts.initialMemberGroup.initialGroupPolicy,
    artifacts.initialOrganizationPolicy,
  ]) {
    expect(policy.projection[0]?.identityBundleFingerprint).toBe(expected);
  }
});
