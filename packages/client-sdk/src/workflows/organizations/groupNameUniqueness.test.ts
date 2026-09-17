import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { readTestGroupName } from "../../../test/helpers/groupMetadata";
import { createGroupNameDirectory } from "../../../test/helpers/groupNameDirectory";
import { loadOrganizationExternalAdminPolicy } from "../principals/externalAdminPolicy";
import { assertGroupNameUniqueInDirectory } from "./groupNameUniqueness";

// Signed group names are unique per organization by construction: before an
// admin signs a new group, every group committed in the signed directory is
// verified and its committed name compared by canonical key.

async function createUniquenessCheck(testLabel: string) {
  const { close, execSql } = await createTestExecSql(testLabel);
  const directory = await createGroupNameDirectory();
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
      readEncryptedName: readTestGroupName,
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
