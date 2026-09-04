import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  KeyingVerificationError,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
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

async function createUniquenessCheck(testLabel: string) {
  const { close, execSql } = await createTestExecSql(testLabel);
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
      organizationId: directory.author.organizationId,
      resolveTrustedUserIdentity: directory.resolveTrustedUserIdentity,
    });
  return { assertUnique, close, directory };
}

const TAKEN = "Another signed group in this organization already carries";

test("a new group name must not collide with any signed group by canonical key", async () => {
  const { assertUnique, close } = await createUniquenessCheck(
    "group-name-uniqueness",
  );
  try {
    await expect(assertUnique("Finance")).resolves.toBeUndefined();
    // Case, spacing, and an embedded zero-width space do not make a new name.
    // A taken name is a plain error, not a KeyingVerificationError: creation
    // runs under security-incident reporting and a retyped name is no incident.
    await expect(assertUnique(" OPERATORS ")).rejects.toThrow(TAKEN);
    await expect(assertUnique(" OPERATORS ")).rejects.not.toBeInstanceOf(
      KeyingVerificationError,
    );
    await expect(
      assertUnique(`Oper${String.fromCodePoint(0x200b)}ators`),
    ).rejects.toThrow(TAKEN);
    // The reserved groups are ordinary directory entries for this purpose.
    await expect(assertUnique("admins")).rejects.toThrow(TAKEN);
    await expect(assertUnique("Members")).rejects.toThrow(TAKEN);
  } finally {
    close();
  }
});

test("a verified directory walk is served locally until a head moves", async () => {
  const { assertUnique, close, directory } = await createUniquenessCheck(
    "group-name-uniqueness-cache",
  );
  try {
    await expect(assertUnique("Finance")).resolves.toBeUndefined();
    // The groups load in parallel, so only the set of fetches is fixed.
    expect(
      directory.fetched.filter((call) => call.startsWith("group:")).sort(),
    ).toEqual(["group:admins-group", "group:group-1", "group:members-group"]);
    // Every group was verified and retained at its directory head, so the
    // next creation finds them locally.
    directory.fetched.length = 0;
    await expect(assertUnique("Legal")).resolves.toBeUndefined();
    expect(directory.fetched).toEqual([]);
  } finally {
    close();
  }
});

test("a directory group served at another head fails closed", async () => {
  const { assertUnique, close, directory } = await createUniquenessCheck(
    "group-name-uniqueness-head",
  );
  try {
    directory.servedGroups["group-1"] = directory.memberPolicy;
    // Head drift can come from a concurrent admin, so it is a plain error to
    // retry on rather than a security incident.
    await expect(assertUnique("Finance")).rejects.toThrow(
      "does not match the signed organization directory",
    );
    await expect(assertUnique("Finance")).rejects.not.toBeInstanceOf(
      KeyingVerificationError,
    );
  } finally {
    close();
  }
});

test("a directory group that fails verification fails closed", async () => {
  const { assertUnique, close, directory } = await createUniquenessCheck(
    "group-name-uniqueness-verify",
  );
  try {
    // Same head, tampered projection: the signed projection root no longer
    // matches, so the group cannot vouch for any name.
    directory.servedGroups["group-1"] = {
      ...directory.operatorsPolicy,
      currentProjection: [
        ...directory.operatorsPolicy.currentProjection,
        { role: "member", userId: "intruder" },
      ],
    };
    await expect(assertUnique("Finance")).rejects.toBeInstanceOf(
      KeyingVerificationError,
    );
    await expect(assertUnique("Finance")).rejects.toThrow(
      "projection root does not match projection",
    );
  } finally {
    close();
  }
});
