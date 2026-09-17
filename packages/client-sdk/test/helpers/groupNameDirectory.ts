import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { createAuthor } from "./containerFixtures";
import { buildInitialGroupPolicyRequest } from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export async function createGroupNameDirectory() {
  const { author, signingPublicKey } = await createAuthor({
    organizationId: "organization-1",
    userId: "signer-user-1",
  });
  const memberKem = generateKemSeedAndKeyPair();
  const buildGroup = (groupId: string, name: string) =>
    buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      groupId,
      name,
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    });
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildGroup("admins-group", "Admins"),
  );
  const memberPolicy = await policyBundleFromInitialRequest(
    await buildGroup("members-group", "Members"),
  );
  const operatorsPolicy = await policyBundleFromInitialRequest(
    await buildGroup("group-1", "Operators"),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: "admins-group",
      encapsulationPublicKey: memberKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(memberPolicy),
        principalPolicyHead(operatorsPolicy),
      ],
      memberGroupId: "members-group",
      organizationId: author.organizationId,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
      userId: author.signerUserId,
    }),
  );
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === author.signerUserId
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: memberKem.publicKey,
          signingKeyFingerprint: author.signerKeyFingerprint,
          signingPublicKey,
          userId,
        })
      : null;
  const fetched: string[] = [];
  const servedGroups: Record<string, PrincipalPolicyBundleResponse> = {
    "admins-group": adminPolicy,
    "group-1": operatorsPolicy,
    "members-group": memberPolicy,
  };
  const apiClient = {
    getCurrentPrincipalPolicy: async (
      principalType: "group" | "organization",
      principalId: string,
    ) => {
      fetched.push(`${principalType}:${principalId}`);
      if (principalType === "organization") return organizationPolicy;
      return servedGroups[principalId] ?? null;
    },
  };
  return {
    apiClient,
    author,
    fetched,
    memberPolicy,
    operatorsPolicy,
    resolveTrustedUserIdentity,
    servedGroups,
  };
}
