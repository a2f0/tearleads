import { expect, test } from "bun:test";
import { verifyPrincipalPolicyBundle } from "@tearleads/crypto";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import {
  createFixtureUserIdentity,
  fixtureProjectionMember,
} from "../../../test/helpers/trustedUserIdentity";
import { collectPrincipalPolicySignerPublicKeys } from "../../workflows/principals/policyVerification";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import { createIdentityLink } from "../trustedUserIdentity/identityLink";

type Fixture = Awaited<ReturnType<typeof principalIdentityPinFixture>>;

function pins(fixture: Fixture, userId: string) {
  return fixture.execSql(
    "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
    [userId],
  );
}

test("a refused member candidate is not pinned and a corrected retry succeeds", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [signer, member] = fixture.members;
    if (!signer || !member) throw new Error("Missing identities");
    fixture.responses.set(member.identity.userId, {
      ...member.response,
      encapsulationPublicKey: signer.response.encapsulationPublicKey,
      encapsulationKeyFingerprint: signer.response.encapsulationKeyFingerprint,
    });
    await expect(fixture.verify()).rejects.toMatchObject({
      code: "hash_mismatch",
    });
    // A failed check publishes no first sight, not even for a matching member.
    expect(await pins(fixture, signer.identity.userId)).toEqual([]);
    expect(await pins(fixture, member.identity.userId)).toEqual([]);
    expect(fixture.checkpointContext.policies).toEqual([]);
    // No manual eviction: the refused candidate must not be served again.
    fixture.responses.set(member.identity.userId, member.response);
    await expect(fixture.verify()).resolves.toHaveLength(1);
    expect(await pins(fixture, member.identity.userId)).toEqual([
      { provenance: "observed" },
    ]);
    await expect(
      fixture.service.verifyLink(
        await createIdentityLink(member.identity, "https://app.example.test"),
      ),
    ).resolves.toMatchObject({ userId: member.identity.userId });
  } finally {
    fixture.close();
  }
});

test("an unsigned projection member is compared but never pinned before verification", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [signer, member] = fixture.members;
    if (!signer || !member) throw new Error("Missing identities");
    const target = await createFixtureUserIdentity({
      userId: crypto.randomUUID(),
    });
    const substitute = await createFixtureUserIdentity({
      userId: target.identity.userId,
    });
    fixture.responses.set(target.identity.userId, substitute.response);
    // The signed state, roots and signature are untouched: only the unsigned
    // projection gains a member whose commitment matches the served keys.
    const forged = structuredClone(fixture.bundle);
    forged.currentProjection.push(
      fixtureProjectionMember(substitute, "member"),
    );
    const keys = await collectPrincipalPolicySignerPublicKeys({
      bundle: forged,
      resolveTrustedUserIdentity: fixture.service.resolve,
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
    // Signer first sight keeps its documented `observed` pin.
    expect(await pins(fixture, signer.identity.userId)).toEqual([
      { provenance: "observed" },
    ]);
    // Once a signed projection verifies, its members are pinned on first sight.
    await expect(fixture.verify()).resolves.toHaveLength(1);
    expect(await pins(fixture, member.identity.userId)).toEqual([
      { provenance: "observed" },
    ]);
    // The honest identity remains linkable. Eviction isolates the durable store
    // from the identity endpoint's in-memory response cache.
    fixture.responses.set(target.identity.userId, target.response);
    fixture.api.evictUserIdentity(target.identity.userId);
    await expect(
      fixture.service.verifyLink(
        await createIdentityLink(target.identity, "https://app.example.test"),
      ),
    ).resolves.toMatchObject({ userId: target.identity.userId });
    expect(await pins(fixture, target.identity.userId)).toEqual([
      { provenance: "link" },
    ]);
  } finally {
    fixture.close();
  }
});

/** Switch the account or database once a pin insert ran, before its commit. */
function switchScopeAfterPinInsert(
  fixture: Fixture,
  change: "account" | "database",
) {
  fixture.afterSql((sql) => {
    if (
      !sql.startsWith("insert") ||
      !sql.includes("trusted_user_identity_pins")
    )
      return;
    fixture.afterSql(undefined);
    if (change === "database") fixture.scope.execSql = null;
    else fixture.scope.localUserId = crypto.randomUUID();
  });
}

for (const change of ["account", "database"] as const) {
  test(`${change} switch during publication commits no first sight`, async () => {
    const fixture = await principalIdentityPinFixture(2);
    try {
      switchScopeAfterPinInsert(fixture, change);
      await expect(fixture.verify()).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
      for (const member of fixture.members)
        expect(await pins(fixture, member.identity.userId)).toEqual([]);
      expect(fixture.checkpointContext.policies).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test(`${change} switch during direct resolution commits no pin`, async () => {
    const fixture = await principalIdentityPinFixture(1);
    try {
      const [member] = fixture.members;
      if (!member) throw new Error("Missing identity");
      switchScopeAfterPinInsert(fixture, change);
      await expect(
        fixture.service.resolve(member.identity.userId),
      ).rejects.toBeInstanceOf(DatabaseUnavailableError);
      expect(await pins(fixture, member.identity.userId)).toEqual([]);
    } finally {
      fixture.close();
    }
  });
}
