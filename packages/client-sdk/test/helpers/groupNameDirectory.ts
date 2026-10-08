import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import { createAuthor } from "./containerFixtures";
import {
  buildInitialGroupPolicyRequest,
  testGroupMetadataKey,
} from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "./principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export async function createGroupNameDirectory(
  input: { readonly useUuidIds?: boolean } = {},
) {
  const organizationId = input.useUuidIds
    ? crypto.randomUUID()
    : "organization-1";
  const userId = input.useUuidIds ? crypto.randomUUID() : "signer-user-1";
  const adminGroupId = input.useUuidIds ? crypto.randomUUID() : "admins-group";
  const memberGroupId = input.useUuidIds
    ? crypto.randomUUID()
    : "members-group";
  const operatorsGroupId = input.useUuidIds ? crypto.randomUUID() : "group-1";
  const { author, signingPublicKey } = await createAuthor({
    organizationId,
    userId,
  });
  const memberKem = generateKemSeedAndKeyPair();
  const buildGroup = (groupId: string, name: string) =>
    buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: memberKem,
      groupId,
      name,
      metadataKey: testGroupMetadataKey(organizationId),
      signerUserId: author.signerUserId,
      signingFingerprint: author.signerKeyFingerprint,
      signingKeyPair: {
        signingPrivateKey: author.signerPrivateKey,
        signingPublicKey,
      },
    });
  const adminPolicy = await policyBundleFromInitialRequest(
    await buildGroup(adminGroupId, "Admins"),
  );
  const memberPolicy = await policyBundleFromInitialRequest(
    await buildGroup(memberGroupId, "Members"),
  );
  const operatorsPolicy = await policyBundleFromInitialRequest(
    await buildGroup(operatorsGroupId, "Operators"),
  );
  const organizationPolicy = await organizationPolicyBundleFromInitialRequest(
    author.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId,
      encapsulationPublicKey: memberKem.publicKey,
      groupHeads: [
        principalPolicyHead(adminPolicy),
        principalPolicyHead(memberPolicy),
        principalPolicyHead(operatorsPolicy),
      ],
      memberGroupId,
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
    [adminGroupId]: adminPolicy,
    [operatorsGroupId]: operatorsPolicy,
    [memberGroupId]: memberPolicy,
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
    adminPolicy,
    apiClient,
    author,
    fetched,
    memberPolicy,
    operatorsPolicy,
    resolveTrustedUserIdentity,
    servedGroups,
  };
}
