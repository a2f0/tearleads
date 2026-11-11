import { expect, test } from "bun:test";
import { principalIdentityPinFixture } from "../../../../test/helpers/principalIdentityPinFixture";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createFixtureUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { validatePrincipalPolicyBundleForCache } from "./principalPolicyCacheValidation";

test("cache validation pins its signer, so a later substitute conflicts instead of pinning", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [signer] = fixture.members;
    if (!signer) throw new Error("Missing signer");
    const validate = () =>
      validatePrincipalPolicyBundleForCache({
        bundle: fixture.bundle,
        loadExternalAdminPolicy: async () => null,
        localCheckpoint: null,
        reference: principalPolicyHead(fixture.bundle),
        resolveTrustedUserIdentity: fixture.service.resolve,
      });
    await expect(validate()).resolves.toMatchObject({ ok: true });
    const pins = () =>
      fixture.execSql(
        "SELECT provenance, signing_key_fingerprint FROM trusted_user_identity_pins WHERE user_id = ?",
        [signer.identity.userId],
      );
    const honest = [
      {
        provenance: "observed",
        signing_key_fingerprint: signer.identity.signingKeyFingerprint,
      },
    ];
    expect(await pins()).toEqual(honest);
    // The endpoint later substitutes the signer: any first-sight lookup now
    // meets the verified pin and refuses, and the policy still validates.
    const substitute = await createFixtureUserIdentity({
      userId: signer.identity.userId,
    });
    fixture.responses.set(signer.identity.userId, substitute.response);
    // Later: the client's cached endpoint answer has expired.
    fixture.api.evictUserIdentity(signer.identity.userId);
    await expect(
      fixture.service.resolve(signer.identity.userId),
    ).rejects.toMatchObject({ code: "equivocation" });
    expect(await pins()).toEqual(honest);
    await expect(validate()).resolves.toMatchObject({ ok: true });
  } finally {
    fixture.close();
  }
});
