import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  verifyPrincipalPolicyBundle,
} from "@tearleads/crypto";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import { createProjectionCheckpointContext } from "../../../data/keyingProjectionVerification/checkpoints/checkpointContext";
import { runWithSecurityIncidentReporting } from "../../../data/keyingProjectionVerification/error";
import { referencedPrincipalPolicyKey } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyCache";
import { collectReferencedPrincipalPolicies } from "../../../data/keyingProjectionVerification/principalPolicy/principalPolicyVerification";
import { identityPolicyFixture } from "./policyIdentity.testFixtures";

test("cached policy admission rechecks pinned bundles before recording a checkpoint", async () => {
  const { bundle, identity } = await identityPolicyFixture();
  const verified = await verifyPrincipalPolicyBundle({
    bundle,
    signerPublicKeys: [
      {
        userId: identity.userId,
        signingKeyFingerprint: identity.signingKeyFingerprint,
        signingPublicKey: identity.signingPublicKey,
      },
    ],
  });
  if (!verified.ok) throw verified.error;
  const substituted = createTestTrustedUserIdentity({
    ...identity,
    encapsulationPublicKey: generateKemSeedAndKeyPair().publicKey,
  });
  const checkpointContext = createProjectionCheckpointContext({
    execSql: async () => [],
  });
  const reference = bundle.currentState;
  await expect(
    collectReferencedPrincipalPolicies({
      checkpointContext,
      organizationId: crypto.randomUUID(),
      principalPolicyCache: new Map([
        [referencedPrincipalPolicyKey(reference), verified.value],
      ]),
      references: [reference],
      resolveUserKey: async () => substituted,
    }),
  ).rejects.toMatchObject({ code: "hash_mismatch" });
  expect(checkpointContext.policies).toEqual([]);
});

test("a missing cached member identity defers without reporting tampering or advancing checkpoints", async () => {
  const { bundle, identity } = await identityPolicyFixture();
  const verified = await verifyPrincipalPolicyBundle({
    bundle,
    signerPublicKeys: [
      {
        userId: identity.userId,
        signingKeyFingerprint: identity.signingKeyFingerprint,
        signingPublicKey: identity.signingPublicKey,
      },
    ],
  });
  if (!verified.ok) throw verified.error;
  const checkpointContext = createProjectionCheckpointContext({
    execSql: async () => [],
  });
  const incidents: unknown[] = [];
  await expect(
    runWithSecurityIncidentReporting(
      async (error) => {
        incidents.push(error);
      },
      { operation: "policy.verify", objectKind: "container", objectId: null },
      () =>
        collectReferencedPrincipalPolicies({
          checkpointContext,
          organizationId: crypto.randomUUID(),
          principalPolicyCache: new Map([
            [referencedPrincipalPolicyKey(bundle.currentState), verified.value],
          ]),
          references: [bundle.currentState],
          resolveUserKey: async () => null,
        }),
    ),
  ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
  expect(incidents).toEqual([]);
  expect(checkpointContext.policies).toEqual([]);
});
