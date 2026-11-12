import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { principalPolicyBundleFromInitialPolicy } from "../../../../test/helpers/policyCacheFixtures";
import { principalIdentityPinFixture } from "../../../../test/helpers/principalIdentityPinFixture";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../../test/helpers/principalPolicySnapshots";
import { createFixtureUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { buildInitialOrganizationPolicyRequest } from "../../registration/organizationProvisioning";
import { cachePrincipalPolicyBundles } from ".";

type PinFixture = Awaited<ReturnType<typeof principalIdentityPinFixture>>;

function cacheBundles(
  pins: PinFixture,
  organizationId: string,
  bundles: readonly PrincipalPolicyBundleResponse[],
  served: readonly PrincipalPolicyBundleResponse[],
) {
  return cachePrincipalPolicyBundles({
    bundles,
    currentPolicyReader: {
      getCurrentPrincipalPolicy: async (_type, principalId) =>
        served.find(
          (bundle) => bundle.currentState.principalId === principalId,
        ) ?? null,
    },
    execSql: pins.execSql,
    organizationId,
    reportSecurityIncident: async () => {},
    resolveTrustedUserIdentity: pins.service.resolve,
  });
}

function pinRows(pins: PinFixture, userId: string) {
  return pins.execSql(
    "SELECT provenance, signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
    [userId],
  );
}

test("a self-signed group outside any signed directory pins nothing", async () => {
  const pins = await principalIdentityPinFixture(2);
  try {
    // The bundle verifies on its own, but no organization directory scopes
    // it, so the cache refuses it before any first sight is published.
    await cacheBundles(pins, "org-without-directory", [pins.bundle], []);
    for (const member of pins.members)
      expect(await pinRows(pins, member.identity.userId)).toEqual([]);
  } finally {
    pins.close();
  }
});

// Functional coverage: this single-user fixture also pins its signer through
// the organization and Admins dependency verification, so the outside-directory
// test above is the control for publishing only after scoping.
test("a directory-scoped group pins its signer, so a later substitute conflicts", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const organizationId = crypto.randomUUID();
  const organization = await principalPolicyBundleFromInitialPolicy({
    principalId: organizationId,
    policy: await buildInitialOrganizationPolicyRequest({
      identityTrustDomain: "https://api.example.test",
      adminGroupId: fixture.admin.currentState.principalId,
      memberGroupId: fixture.subject.currentState.principalId,
      groupHeads: [
        principalPolicyHead(fixture.adminBundle),
        principalPolicyHead(fixture.subjectBundle),
      ],
      encapsulationPublicKey: fixture.encapsulationKeyPair.publicKey,
      organizationId,
      signingKeyPair: fixture.signingKeyPair,
      userId: fixture.signerUserId,
    }),
  });
  const signer = await fixture.resolveUserKey(fixture.signerUserId);
  if (!signer) throw new Error("Missing fixture signer");
  const pins = await principalIdentityPinFixture(1);
  try {
    pins.responses.set(signer.userId, {
      userId: signer.userId,
      signingPublicKey: bytesToBase64(signer.signingPublicKey),
      signingKeyFingerprint: signer.signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(signer.encapsulationPublicKey),
      encapsulationKeyFingerprint: signer.encapsulationKeyFingerprint,
    });
    await cacheBundles(
      pins,
      organizationId,
      [fixture.subjectBundle],
      [organization, fixture.adminBundle, fixture.subjectBundle],
    );
    const honest = [
      {
        provenance: "observed",
        signing_key_fingerprint: signer.signingKeyFingerprint,
      },
    ];
    expect(await pinRows(pins, signer.userId)).toEqual(honest);
    // The endpoint later substitutes the signer: a first-sight lookup now
    // meets the verified pin and refuses instead of pinning the substitute.
    const substitute = await createFixtureUserIdentity({
      userId: signer.userId,
    });
    pins.responses.set(signer.userId, substitute.response);
    pins.api.evictUserIdentity(signer.userId);
    await expect(pins.service.resolve(signer.userId)).rejects.toMatchObject({
      code: "equivocation",
    });
    expect(await pinRows(pins, signer.userId)).toEqual(honest);
  } finally {
    pins.close();
  }
});
