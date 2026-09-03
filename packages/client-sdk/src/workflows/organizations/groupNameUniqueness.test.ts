import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { createAuthor } from "../../../test/helpers/containerFixtures";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import { buildInitialOrganizationPolicyRequest } from "../registration/registerIdentity";
import { assertGroupNameUniqueInDirectory } from "./groupNameUniqueness";
import { buildInitialGroupPolicyRequest } from "./principalPolicyRequest";

// Signed group names are unique per organization by construction: before an
// admin signs a new group, every group committed in the signed directory is
// verified and its committed name compared by canonical key.

async function createDirectory() {
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
  const apiClient = {
    getCurrentPrincipalPolicy: async (
      principalType: "group" | "organization",
      principalId: string,
    ) => {
      fetched.push(`${principalType}:${principalId}`);
      if (principalType === "organization") return organizationPolicy;
      if (principalId === "admins-group") return adminPolicy;
      if (principalId === "members-group") return memberPolicy;
      return operatorsPolicy;
    },
  };
  return { apiClient, author, fetched, resolveTrustedUserIdentity };
}

test("a new group name must not collide with any signed group by canonical key", async () => {
  const { close, execSql } = await createTestExecSql("group-name-uniqueness");
  try {
    const directory = await createDirectory();
    const externalAdminPolicy = await loadOrganizationExternalAdminPolicy({
      execSql,
      getCurrentPrincipalPolicy: directory.apiClient.getCurrentPrincipalPolicy,
      organizationId: directory.author.organizationId,
      resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
    });
    if (!externalAdminPolicy) {
      throw new Error("Expected the organization admin authority to verify");
    }
    const assertUnique = (name: string) =>
      assertGroupNameUniqueInDirectory({
        apiClient: directory.apiClient,
        descriptor: externalAdminPolicy.descriptor,
        execSql,
        externalAuthority: externalAdminPolicy.externalAuthority,
        name,
        resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
      });

    await expect(assertUnique("Finance")).resolves.toBeUndefined();
    // Case, spacing, and an embedded zero-width space do not make a new name.
    // A taken name is a plain error, not a KeyingVerificationError: creation
    // runs under security-incident reporting and a retyped name is no incident.
    const taken = "Another signed group in this organization already carries";
    await expect(assertUnique(" OPERATORS ")).rejects.toThrow(taken);
    await expect(assertUnique(" OPERATORS ")).rejects.not.toBeInstanceOf(
      KeyingVerificationError,
    );
    await expect(
      assertUnique(`Oper${String.fromCodePoint(0x200b)}ators`),
    ).rejects.toThrow(taken);
    // Reserved names are refused without fetching the reserved groups.
    directory.fetched.length = 0;
    await expect(assertUnique("admins")).rejects.toThrow(
      "A reserved organization group already carries this name",
    );
    expect(directory.fetched).toEqual([]);
  } finally {
    close();
  }
});
