import { expect, test } from "bun:test";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import { principalPolicyBundleFromInitialPolicy } from "../../../../test/helpers/policyCacheFixtures";
import { principalIdentityPinFixture } from "../../../../test/helpers/principalIdentityPinFixture";
import { principalPolicyHead } from "../../../../test/helpers/principalPolicyFixtures";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../../test/helpers/principalPolicySnapshots";
import { buildInitialOrganizationPolicyRequest } from "../../../workflows/registration/organizationProvisioning";
import { savePrincipalPolicyBundle } from "../../persistence/principalPolicy/principalPolicyPersistence";
import { createProjectionCheckpointContext } from "../checkpoints/checkpointContext";
import { ProjectionVerificationCancelledError } from "../types";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";

/**
 * A group authorized by its organization's Admins, all stored locally, with
 * identities served by the real pinning service. The verification is
 * cancelled on the identity endpoint's `cancelOnHit`-th read, which lands
 * inside the organization and Admins dependency verification.
 */
async function externallyAuthorizedVerification(cancelOnHit: number) {
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
  pins.responses.set(signer.userId, {
    userId: signer.userId,
    signingPublicKey: bytesToBase64(signer.signingPublicKey),
    signingKeyFingerprint: signer.signingKeyFingerprint,
    encapsulationPublicKey: bytesToBase64(signer.encapsulationPublicKey),
    encapsulationKeyFingerprint: signer.encapsulationKeyFingerprint,
  });
  let hits = 0;
  let cancelled = false;
  const served = pins.responses.get.bind(pins.responses);
  pins.responses.get = (userId: string) => {
    hits += 1;
    return served(userId);
  };
  const database = await createTestExecSql("external-authority-lifetime");
  for (const bundle of [
    fixture.adminBundle,
    fixture.subjectBundle,
    organization,
  ])
    await savePrincipalPolicyBundle(
      database.execSql,
      bundle,
      "2026-09-12T00:00:00.000Z",
      organizationId,
    );
  return {
    verify: () =>
      collectReferencedPrincipalPolicies({
        checkpointContext: createProjectionCheckpointContext({
          execSql: database.execSql,
        }),
        organizationId,
        principalPolicyCache: new Map(),
        references: [principalPolicyHead(fixture.subjectBundle)],
        resolveUserKey: pins.service.resolve,
        stillCurrent: () => !cancelled && hits < cancelOnHit,
      }),
    hits: () => hits,
    /** Cancel once a pin insert ran, before its transaction commits. */
    cancelAtPinWrite() {
      pins.afterSql((sql) => {
        if (
          sql.startsWith("insert") &&
          sql.includes("trusted_user_identity_pins")
        )
          cancelled = true;
      });
    },
    pinRows: () =>
      pins.execSql(
        "SELECT provenance FROM trusted_user_identity_pins WHERE user_id = ?",
        [signer.userId],
      ),
    close() {
      database.close();
      pins.close();
    },
  };
}

// The fixture reads its one signer twice: publication takes the staged
// answer, so cancellation there is exercised at the pin write below.
for (const cancelOnHit of [1, 2]) {
  test(`dependency verification cancelled at identity read ${cancelOnHit} pins nothing`, async () => {
    const run = await externallyAuthorizedVerification(cancelOnHit);
    try {
      await expect(run.verify()).rejects.toBeInstanceOf(
        ProjectionVerificationCancelledError,
      );
      expect(run.hits()).toBeGreaterThanOrEqual(cancelOnHit);
      expect(await run.pinRows()).toEqual([]);
    } finally {
      run.close();
    }
  });
}

test("dependency verification cancelled at its pin write pins nothing", async () => {
  const run = await externallyAuthorizedVerification(Number.POSITIVE_INFINITY);
  try {
    run.cancelAtPinWrite();
    await expect(run.verify()).rejects.toBeInstanceOf(
      ProjectionVerificationCancelledError,
    );
    expect(await run.pinRows()).toEqual([]);
  } finally {
    run.close();
  }
});

test("uncancelled dependency verification pins its signer", async () => {
  const run = await externallyAuthorizedVerification(Number.POSITIVE_INFINITY);
  try {
    await expect(run.verify()).resolves.toHaveLength(1);
    expect(run.hits()).toBe(2);
    expect(await run.pinRows()).toEqual([{ provenance: "observed" }]);
  } finally {
    run.close();
  }
});
