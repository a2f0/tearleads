import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "../../../test/helpers/principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
  projectionPolicyWarmer,
} from "../../../test/helpers/projectionPolicyHistory";
import { sharedReplacementBindingFixture } from "../../../test/helpers/sharedReplacementBinding";
import { createTestTrustedUserIdentityResolver } from "../../../test/helpers/trustedUserIdentity";
import { rootContainerWriterProjectionFromCreatePlan } from "../../workflows/containers/root/create";
import { buildInitialOrganizationPolicyRequest } from "../../workflows/registration/registerIdentity";
import { loadOrganizationFounder } from "../persistence/organizationFounderPersistence";
import { verifyContainerDestinationProjection } from "./containerDestinationVerification";

test.each([1, 2])(
  "a rejected founder fork permits genuine directory version %i",
  async (version) => {
    const setup = createNativeTestExecSql();
    const cold = createNativeTestExecSql();
    try {
      const data = await sharedReplacementBindingFixture(setup.execSql);
      const artifacts = data.replacement;
      const groups = await Promise.all(
        [artifacts.initialAdminGroup, artifacts.initialMemberGroup].map(
          policyBundleFromInitialRequest,
        ),
      );
      const attackerUserId = crypto.randomUUID();
      const signing = generateSigningSeedAndKeyPair();
      const kem = generateKemSeedAndKeyPair();
      const impostor = await organizationPolicyBundleFromInitialRequest(
        artifacts.organizationId,
        await buildInitialOrganizationPolicyRequest({
          organizationId: artifacts.organizationId,
          adminGroupId: artifacts.initialAdminGroup.groupId,
          memberGroupId: artifacts.initialMemberGroup.groupId,
          groupHeads: groups.map((group) => principalPolicyHead(group)),
          userId: attackerUserId,
          signingKeyPair: signing,
          encapsulationPublicKey: kem.publicKey,
        }),
      );
      const attackerIdentity = createTestTrustedUserIdentityResolver({
        userId: attackerUserId,
        signingKeyFingerprint: await toFingerprint(signing.signingPublicKey),
        signingPublicKey: signing.signingPublicKey,
        encapsulationPublicKey: kem.publicKey,
      });
      // Both signatures are real. The forged directory cites the genuine
      // root's genuine Admins policy, but its founder is a different user.
      const projection = {
        ...rootContainerWriterProjectionFromCreatePlan(
          artifacts.rootContainer.plan,
        ),
        policyEvidence: {
          organization: projectionPolicySource(impostor),
          organizationPayloads: [projectionDirectoryPayload(impostor)],
          groups: groups.map(projectionPolicySource),
        },
      };
      const resolveUserKey = (userId: string) =>
        userId === attackerUserId
          ? attackerIdentity(userId)
          : data.input.runtime.resolveTrustedUserIdentity(userId);
      await expect(
        verifyContainerDestinationProjection({
          execSql: cold.execSql,
          warmReferencedPrincipalPolicies: projectionPolicyWarmer({
            execSql: cold.execSql,
            bundles: [impostor, ...groups],
            resolveUserKey,
          }),
          projection,
          resolveUserKey: (userId) =>
            userId === attackerUserId
              ? attackerIdentity(userId)
              : data.input.runtime.resolveTrustedUserIdentity(userId),
        }),
      ).rejects.toMatchObject({ code: "signer_mismatch" });
      expect(
        await loadOrganizationFounder(cold.execSql, artifacts.organizationId),
      ).toBeNull();
      const initial = await organizationPolicyBundleFromInitialRequest(
        artifacts.organizationId,
        artifacts.initialOrganizationPolicy,
      );
      const genuine =
        version === 1
          ? initial
          : await signedPrincipalPolicyBundle({
              memberEnvelopes: initial.currentMemberEnvelopes.envelopes,
              payloadCiphertext: initial.currentPayload.ciphertext,
              projection: initial.currentProjection,
              previousStates: [
                {
                  state: initial.currentState,
                  projection: initial.currentProjection,
                  grants: initial.currentGrants,
                },
              ],
              signing: {
                ...initial.currentState,
                version: 2,
                prevStateHash: initial.currentState.stateHash,
                grants: initial.currentGrants,
              },
              signingPrivateKey: data.signingKeyPair.signingPrivateKey,
            });
      await verifyContainerDestinationProjection({
        execSql: cold.execSql,
        warmReferencedPrincipalPolicies: projectionPolicyWarmer({
          execSql: cold.execSql,
          bundles: [genuine, ...groups],
          resolveUserKey,
        }),
        projection: {
          ...projection,
          policyEvidence: {
            ...projection.policyEvidence,
            organization: projectionPolicySource(genuine),
            organizationPayloads: [projectionDirectoryPayload(genuine)],
          },
        },
        resolveUserKey: data.input.runtime.resolveTrustedUserIdentity,
      });
      expect(
        await loadOrganizationFounder(cold.execSql, artifacts.organizationId),
      ).toMatchObject({ userId: data.userId });
    } finally {
      setup.close();
      cold.close();
    }
  },
);
