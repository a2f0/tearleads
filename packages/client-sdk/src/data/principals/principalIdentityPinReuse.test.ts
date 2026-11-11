import { expect, test } from "bun:test";
import { verifyPrincipalPolicyBundle } from "@tearleads/crypto";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import {
  createFixtureUserIdentity,
  fixtureProjectionMember,
} from "../../../test/helpers/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../../workflows/principals/policyVerification";
import { createProjectionUserKeyResolver } from "../keyingProjectionVerification/userKeyResolver";

type Fixture = Awaited<ReturnType<typeof principalIdentityPinFixture>>;

function pins(fixture: Fixture, userId: string) {
  return fixture.execSql(
    "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
    [userId],
  );
}

test("the caching projection key resolver stages unsigned members too", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [, member] = fixture.members;
    if (!member) throw new Error("Missing identities");
    const target = await createFixtureUserIdentity({
      userId: crypto.randomUUID(),
    });
    fixture.responses.set(target.identity.userId, target.response);
    const forged = structuredClone(fixture.bundle);
    forged.currentProjection.push(fixtureProjectionMember(target, "member"));
    // Keying verification reaches the pin service through this wrapper.
    const resolver = createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: fixture.service.resolve,
    });
    const keys = await collectPrincipalPolicySignerPublicKeys({
      bundle: forged,
      resolveTrustedUserIdentity: resolver,
    });
    if ("error" in keys) throw new Error(keys.error);
    expect(
      await verifyPrincipalPolicyBundle({
        bundle: forged,
        signerPublicKeys: keys.signerPublicKeys,
      }),
    ).toMatchObject({ ok: false });
    expect(await pins(fixture, target.identity.userId)).toEqual([]);
    expect(await pins(fixture, member.identity.userId)).toEqual([]);
    // Once a signed projection verifies, the wrapper still publishes.
    await expect(fixture.verify(resolver)).resolves.toHaveLength(1);
    expect(await pins(fixture, member.identity.userId)).toEqual([
      { provenance: "observed" },
    ]);
  } finally {
    fixture.close();
  }
});

test("a cached policy rechecks a member that only its history holds", async () => {
  const fixture = await principalIdentityPinFixture(2, {
    removeLastMember: true,
  });
  try {
    const [, removed] = fixture.members;
    if (!removed) throw new Error("Missing identities");
    expect(
      fixture.bundle.currentProjection.map(({ userId }) => userId),
    ).not.toContain(removed.identity.userId);
    const substitute = await createFixtureUserIdentity({
      userId: removed.identity.userId,
    });
    fixture.responses.set(removed.identity.userId, substitute.response);
    await expect(fixture.verify()).rejects.toMatchObject({
      code: "hash_mismatch",
    });
    expect(await pins(fixture, removed.identity.userId)).toEqual([]);
    // The honest answer verifies and pins the historical member.
    fixture.responses.set(removed.identity.userId, removed.response);
    fixture.api.evictUserIdentity(removed.identity.userId);
    await expect(fixture.verify()).resolves.toHaveLength(1);
    expect(await pins(fixture, removed.identity.userId)).toEqual([
      { provenance: "observed" },
    ]);
  } finally {
    fixture.close();
  }
});
