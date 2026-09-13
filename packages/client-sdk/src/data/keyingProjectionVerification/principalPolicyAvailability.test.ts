import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createParentProjection } from "../../../test/helpers/containerFixtures";
import { principalPolicyBundleFromInitialPolicy } from "../../../test/helpers/policyCacheFixtures";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createExternallyAuthorizedPrincipalPolicySnapshots } from "../../../test/helpers/principalPolicySnapshots";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { buildInitialOrganizationPolicyRequest } from "../../workflows/registration/registerIdentity";
import { savePrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerWriterProjection } from "./containerProjectionVerification";
import { runWithSecurityIncidentReporting } from "./error";
import { collectReferencedPrincipalPolicies } from "./principalPolicyVerification";

test("an unavailable organization signer defers external authorization without an incident", async () => {
  const fixture = await createExternallyAuthorizedPrincipalPolicySnapshots();
  const organizationId = crypto.randomUUID();
  const organization = await principalPolicyBundleFromInitialPolicy({
    principalId: organizationId,
    policy: await buildInitialOrganizationPolicyRequest({
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
  const { close, execSql } = await createTestExecSql(
    "external-policy-availability",
  );
  const incidents: unknown[] = [];
  try {
    for (const bundle of [
      fixture.adminBundle,
      fixture.subjectBundle,
      organization,
    ]) {
      await savePrincipalPolicyBundle(
        execSql,
        bundle,
        "2026-09-12T00:00:00.000Z",
        organizationId,
      );
    }
    const input = {
      checkpointContext: createProjectionCheckpointContext({ execSql }),
      organizationId,
      principalPolicyCache: new Map(),
      references: [principalPolicyHead(fixture.subjectBundle)],
    };
    let keyReads = 0;
    await expect(
      runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        { operation: "policy.verify", objectKind: "container", objectId: null },
        () =>
          collectReferencedPrincipalPolicies({
            ...input,
            resolveUserKey: async (userId) =>
              ++keyReads === 1 ? fixture.resolveUserKey(userId) : null,
          }),
      ),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(keyReads).toBe(2);
    expect(incidents).toEqual([]);
    expect(input.principalPolicyCache.size).toBe(0);
    await expect(
      collectReferencedPrincipalPolicies({
        ...input,
        resolveUserKey: fixture.resolveUserKey,
      }),
    ).resolves.toHaveLength(1);
  } finally {
    close();
  }
});

for (const unavailableAt of [1, 2]) {
  test(`a missing projection identity at read ${unavailableAt} is not tampering`, async () => {
    const fixture = await createParentProjection();
    const { close, execSql } = await createTestExecSql(
      "projection-key-availability",
    );
    const incidents: unknown[] = [];
    const resolveUserKey = createTestTrustedUserIdentityResolver({
      userId: fixture.userId,
      signingKeyFingerprint: fixture.author.signerKeyFingerprint,
      signingPublicKey: fixture.signingPublicKey,
      encapsulationPublicKey: fixture.encapsulationPublicKey,
    });
    let reads = 0;
    try {
      await expect(
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            operation: "container.verify",
            objectKind: "container",
            objectId: fixture.projection.containerId,
          },
          () =>
            verifyContainerWriterProjection({
              execSql,
              projection: fixture.projection,
              resolveUserKey: async () =>
                ++reads === unavailableAt
                  ? null
                  : resolveUserKey(fixture.userId),
            }),
        ),
      ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
      expect(reads).toBe(unavailableAt);
      expect(incidents).toEqual([]);
    } finally {
      close();
    }
  });
}
