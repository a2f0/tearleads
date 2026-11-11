import { expect, test } from "bun:test";
import { principalIdentityPinFixture } from "../../../test/helpers/principalIdentityPinFixture";
import { collectPrincipalPolicySignerPublicKeys } from "../../workflows/principals/policyVerification";
import { runWithSecurityIncidentReporting } from "../keyingProjectionVerification/error";
import { DatabaseUnavailableError } from "../sync/databaseUnavailable";
import {
  createApiUserIdentitySource,
  createTrustedUserIdentityService,
  requireTrustedUserIdentityResolver,
} from "../trustedUserIdentity";

for (const column of [
  "signing_public_key",
  "encapsulation_public_key",
  "format_version",
  "signing_suite",
  "provenance",
] as const) {
  test(`batch verification rejects corrupt pin ${column} without replacing it`, async () => {
    const fixture = await principalIdentityPinFixture(2);
    try {
      await fixture.verify();
      fixture.checkpointContext.policies.length = 0;
      const userId = fixture.members[1]?.identity.userId;
      if (!userId) throw new Error("Missing member");
      await fixture.execSql(
        `UPDATE trusted_user_identity_pins SET ${column} = ? WHERE user_id = ?`,
        [column === "format_version" ? 99 : "invalid", userId],
      );
      fixture.resetCounts();
      await expect(fixture.verify()).rejects.toMatchObject({
        code: "invalid_shape",
      });
      expect(fixture.counts()).toMatchObject({ writes: 0, requests: 0 });
      expect(fixture.checkpointContext.policies).toEqual([]);
      expect(
        await fixture.execSql(
          `SELECT ${column} AS value FROM trusted_user_identity_pins WHERE user_id = ?`,
          [userId],
        ),
      ).toEqual([{ value: column === "format_version" ? 99 : "invalid" }]);
    } finally {
      fixture.close();
    }
  });
}

test("every cached member still compares its full pinned bundle commitment", async () => {
  const fixture = await principalIdentityPinFixture(3);
  try {
    await fixture.verify();
    for (const [index, member] of fixture.members.entries()) {
      const other = fixture.members[(index + 1) % fixture.members.length];
      if (!other) throw new Error("Missing other identity");
      fixture.checkpointContext.policies.length = 0;
      // Self-consistent key/fingerprint corruption reaches the signed commitment guard.
      await fixture.execSql(
        "UPDATE trusted_user_identity_pins SET encapsulation_public_key = ?, encapsulation_key_fingerprint = ? WHERE user_id = ?",
        [
          other.response.encapsulationPublicKey,
          other.response.encapsulationKeyFingerprint,
          member.identity.userId,
        ],
      );
      fixture.resetCounts();
      await expect(fixture.verify()).rejects.toMatchObject({
        code: "hash_mismatch",
        message: `Principal member identity bundle mismatch: ${member.identity.userId}`,
      });
      expect(fixture.counts()).toMatchObject({ writes: 0, requests: 0 });
      expect(fixture.checkpointContext.policies).toEqual([]);
      await fixture.execSql(
        "UPDATE trusted_user_identity_pins SET encapsulation_public_key = ?, encapsulation_key_fingerprint = ? WHERE user_id = ?",
        [
          member.response.encapsulationPublicKey,
          member.response.encapsulationKeyFingerprint,
          member.identity.userId,
        ],
      );
    }
  } finally {
    fixture.close();
  }
});

test("direct resolution still refetches and refuses conflicting remote identities", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    await fixture.verify();
    const [member, other] = fixture.members;
    if (!member || !other) throw new Error("Missing identities");
    fixture.responses.set(member.identity.userId, {
      ...member.response,
      encapsulationPublicKey: other.response.encapsulationPublicKey,
      encapsulationKeyFingerprint: other.response.encapsulationKeyFingerprint,
    });
    fixture.api.evictUserIdentity(member.identity.userId);
    await expect(
      fixture.service.resolve(member.identity.userId),
    ).rejects.toMatchObject({ code: "equivocation" });
    // A rejected candidate is evicted: the corrected endpoint is fetched again.
    fixture.responses.set(member.identity.userId, member.response);
    fixture.resetCounts();
    await expect(
      fixture.service.resolve(member.identity.userId),
    ).resolves.toMatchObject(member.identity);
    expect(fixture.counts().requests).toBe(1);
    await expect(fixture.verify()).resolves.toHaveLength(1);
    await expect(
      fixture.service.resolveVerified(member.identity.userId),
    ).resolves.toBeNull();
    await expect(
      fixture.service.createLinkFor(
        member.identity.userId,
        "https://app.example.test",
      ),
    ).resolves.toBeNull();
  } finally {
    fixture.close();
  }
});

test("missing and wrong-user unpinned identities stay fail-closed", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    const [signer, member] = fixture.members;
    if (!signer || !member) throw new Error("Missing identities");
    await fixture.service.resolve(signer.identity.userId);
    fixture.responses.delete(member.identity.userId);
    const incidents: unknown[] = [];
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        { operation: "policy.verify", objectKind: "container", objectId: null },
        fixture.verify,
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(fixture.checkpointContext.policies).toEqual([]);
    expect(incidents).toEqual([]);
    fixture.responses.set(member.identity.userId, signer.response);
    await expect(fixture.verify()).rejects.toMatchObject({
      code: "object_mismatch",
    });
    expect(fixture.checkpointContext.policies).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("self resolution still checks local keys and cannot use a stale observed pin", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    await fixture.verify();
    const [member, other] = fixture.members;
    if (!member || !other) throw new Error("Missing identities");
    fixture.scope.localUserId = member.identity.userId;
    await fixture.execSql(
      "UPDATE trusted_user_identity_pins SET encapsulation_public_key = ?, encapsulation_key_fingerprint = ? WHERE user_id = ?",
      [
        other.response.encapsulationPublicKey,
        other.response.encapsulationKeyFingerprint,
        member.identity.userId,
      ],
    );
    await expect(fixture.verify()).rejects.toMatchObject({
      code: "equivocation",
    });
  } finally {
    fixture.close();
  }
});

test("signer diagnostics precede member commitment failures through the adapted resolver", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    await fixture.verify();
    const adapted = requireTrustedUserIdentityResolver(fixture.service.resolve);
    fixture.resetCounts();
    await expect(
      collectPrincipalPolicySignerPublicKeys({
        bundle: fixture.bundle,
        resolveTrustedUserIdentity: adapted,
      }),
    ).resolves.toHaveProperty("signerPublicKeys");
    expect(fixture.counts()).toMatchObject({
      transactions: 2,
      pinSelects: 2,
      writes: 0,
    });
    const malformed = {
      ...fixture.bundle,
      currentState: {
        ...fixture.bundle.currentState,
        signerUserKeyFingerprint: "0".repeat(64),
      },
      currentProjection: fixture.bundle.currentProjection.map((member) => ({
        ...member,
        identityBundleFingerprint: "0".repeat(64),
      })),
    };
    await expect(
      collectPrincipalPolicySignerPublicKeys({
        bundle: malformed,
        resolveTrustedUserIdentity: adapted,
      }),
    ).resolves.toEqual({ error: "fingerprint-mismatch" });
  } finally {
    fixture.close();
  }
});

test("a different trust domain cannot reuse matching user IDs from another pin namespace", async () => {
  const fixture = await principalIdentityPinFixture(2);
  try {
    await fixture.verify();
    fixture.checkpointContext.policies.length = 0;
    for (const member of fixture.members)
      fixture.api.evictUserIdentity(member.identity.userId);
    const service = createTrustedUserIdentityService({
      getExecSql: () => fixture.execSql,
      getLocalIdentity: () => null,
      getLocalUserId: () => null,
      identityTrustDomain: "https://other.example.test",
      remoteSource: createApiUserIdentitySource(fixture.api),
    });
    fixture.resetCounts();
    await expect(fixture.verify(service.resolve)).rejects.toMatchObject({
      code: "hash_mismatch",
    });
    expect(fixture.counts().requests).toBe(1);
    expect(fixture.checkpointContext.policies).toEqual([]);
  } finally {
    fixture.close();
  }
});

for (const column of [
  "signing_key_fingerprint",
  "encapsulation_key_fingerprint",
] as const) {
  test(`batch pin validation checks stored ${column} against its key`, async () => {
    const fixture = await principalIdentityPinFixture(2);
    try {
      await fixture.verify();
      fixture.checkpointContext.policies.length = 0;
      await fixture.execSql(
        `UPDATE trusted_user_identity_pins SET ${column} = ? WHERE user_id = ?`,
        ["0".repeat(64), fixture.members[1]?.identity.userId ?? ""],
      );
      await expect(fixture.verify()).rejects.toMatchObject({
        code: "hash_mismatch",
      });
      expect(fixture.checkpointContext.policies).toEqual([]);
    } finally {
      fixture.close();
    }
  });
}

for (const change of ["database", "account"] as const) {
  test(`batch scope refuses changed ${change} before returning a cached policy`, async () => {
    const fixture = await principalIdentityPinFixture(2);
    try {
      await fixture.verify();
      fixture.checkpointContext.policies.length = 0;
      fixture.afterSql((sql) => {
        if (
          sql.startsWith("select") &&
          sql.includes("trusted_user_identity_pins")
        ) {
          if (change === "database") fixture.scope.execSql = null;
          else fixture.scope.localUserId = crypto.randomUUID();
        }
      });
      await expect(fixture.verify()).rejects.toBeInstanceOf(
        DatabaseUnavailableError,
      );
      expect(fixture.checkpointContext.policies).toEqual([]);
    } finally {
      fixture.close();
    }
  });
}
