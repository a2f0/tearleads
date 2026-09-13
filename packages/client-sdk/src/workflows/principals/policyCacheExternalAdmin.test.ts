import { expect, test } from "bun:test";
import {
  buildInitialGroupPolicyRequest,
  buildInitialOrganizationPolicyRequest,
} from "@tearleads/client-sdk";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  cacheReferencedPolicies,
  principalPolicyBundleFromInitialPolicy,
  referencedPrincipalStateFromBundle,
} from "../../../test/helpers/policyCacheFixtures";
import { loadPrincipalPolicyBundle } from "../../data/persistence/principalPolicyPersistence";

test("principal policy sync authorizes empty group bundles from verified organization admins", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-sync-test",
  );

  try {
    const organizationId = "organization-1";
    const groupId = "group-empty-1";
    const adminGroupId = "admins-group-1";
    const signerUserId = "organization-admin-1";
    const signingKeyPair = generateSigningSeedAndKeyPair();
    const encapsulationKeyPair = generateKemSeedAndKeyPair();
    const signingKeyFingerprint = await toFingerprint(
      signingKeyPair.signingPublicKey,
    );
    const encapsulationKeyFingerprint = await toFingerprint(
      encapsulationKeyPair.publicKey,
    );
    const signerKeyResponse = {
      encapsulationKeyFingerprint,
      userId: signerUserId,
      signingPublicKey: bytesToBase64(signingKeyPair.signingPublicKey),
      signingKeyFingerprint,
      encapsulationPublicKey: bytesToBase64(encapsulationKeyPair.publicKey),
    };
    const adminPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: adminGroupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
          groupId: adminGroupId,
          name: "Admins",
          signerUserId,
          signingFingerprint: signingKeyFingerprint,
          signingKeyPair,
        })
      ).initialGroupPolicy,
    });
    const groupPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: groupId,
      policy: (
        await buildInitialGroupPolicyRequest({
          creatorEncapsulationKeyPair: encapsulationKeyPair,
          externalAuthority: {
            principalType: "group",
            principalId: adminPolicy.currentState.principalId,
            version: adminPolicy.currentState.version,
            keyEpoch: adminPolicy.currentState.keyEpoch,
            stateHash: adminPolicy.currentState.stateHash,
            keyFingerprint: adminPolicy.currentState.keyFingerprint,
          },
          groupId,
          includeSignerAsAdmin: false,
          name: "Operators",
          signerUserId,
          signingFingerprint: signingKeyFingerprint,
          signingKeyPair,
        })
      ).initialGroupPolicy,
    });
    const organizationPolicy = await principalPolicyBundleFromInitialPolicy({
      principalId: organizationId,
      policy: await buildInitialOrganizationPolicyRequest({
        adminGroupId,
        encapsulationPublicKey: encapsulationKeyPair.publicKey,
        groupHeads: [
          referencedPrincipalStateFromBundle(adminPolicy),
          {
            ...referencedPrincipalStateFromBundle(adminPolicy),
            principalId: "members-group-1",
          },
          referencedPrincipalStateFromBundle(groupPolicy),
        ],
        memberGroupId: "members-group-1",
        organizationId,
        signingKeyPair,
        userId: signerUserId,
      }),
    });
    const logs: string[] = [];

    await cacheReferencedPolicies({
      execSql,
      getCurrentPrincipalPolicy: async (principalType, principalId) => {
        if (
          principalType === "organization" &&
          principalId === organizationId
        ) {
          return organizationPolicy;
        }
        if (principalType === "group" && principalId === adminGroupId) {
          return adminPolicy;
        }

        expect(principalType).toBe("group");
        expect(principalId).toBe(groupId);
        return groupPolicy;
      },
      getUserIdentity: async (userId) => {
        expect(userId).toBe(signerUserId);
        return signerKeyResponse;
      },
      log: (message) => logs.push(message),
      organizationId,
      references: [referencedPrincipalStateFromBundle(groupPolicy)],
    });

    expect(logs).toEqual([]);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", groupId),
    ).resolves.toEqual(groupPolicy);
    await expect(
      loadPrincipalPolicyBundle(execSql, "organization", organizationId),
    ).resolves.toEqual(organizationPolicy);
    await expect(
      loadPrincipalPolicyBundle(execSql, "group", adminGroupId),
    ).resolves.toEqual(adminPolicy);
  } finally {
    close();
  }
});
