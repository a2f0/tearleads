import { expect, test } from "bun:test";
import { readTestGroupName } from "../../../test/helpers/groupMetadata";
import { createGroupNameDirectory } from "../../../test/helpers/groupNameDirectory";
import { createAuthorityRecoveryFixture } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  principalPolicies,
  principalPolicyCheckpoints,
} from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { GroupMetadataUnreadableError } from "./groupMetadataAccess";
import { hydrateOrganizationGroupNames } from "./organizationGroupNames";

test("current group names hydrate without a full-policy read or fabricated bundle retention", async () => {
  const signed = await createGroupNameDirectory({ useUuidIds: true });
  const organizationId = signed.author.organizationId;
  const organization = await signed.apiClient.getCurrentPrincipalPolicy(
    "organization",
    organizationId,
  );
  if (!organization) throw new Error("Missing directory fixture");
  const f = await createAuthorityRecoveryFixture({
    directory: organization,
    admin: signed.adminPolicy,
    group: signed.operatorsPolicy,
    organizationId,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
  });
  f.policies.set(
    signed.memberPolicy.currentState.principalId,
    signed.memberPolicy,
  );
  let fullReads = 0;
  f.options.apiClient.getCurrentPrincipalPolicy = async () => {
    fullReads += 1;
    throw new Error("Full policy reads are forbidden");
  };
  let current = true;
  const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: f.options.apiClient,
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) =>
      work({ protection: f.options.protection, stillCurrent: () => current }),
  });
  if (!resolveCurrentPolicy) throw new Error("Missing current resolver");
  const input = {
    apiClient: f.options.apiClient,
    directory: {
      directory: {
        organizationId,
        currentUser: { isOrgAdmin: true },
        users: [],
        profileDocumentId: null,
      },
      groups: Object.values(signed.servedGroups).map((bundle) => ({
        organizationId,
        groupId: bundle.currentState.principalId,
        createdAt: bundle.currentState.createdAt,
        isBuiltin:
          bundle.currentState.principalId !==
          signed.operatorsPolicy.currentState.principalId,
        name: "Untrusted label",
        nameUnreadable: false,
        currentState: bundle.currentState,
      })),
      memberGroupId: signed.memberPolicy.currentState.principalId,
      readModelCursor: "cursor",
    },
    execSql: f.options.execSql,
    organizationId,
    organizationPolicyReference: principalPolicyHead(organization),
    resolveCurrentPolicy,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
    readEncryptedName: readTestGroupName,
    reportSecurityIncident: async () => {},
    stillCurrent: () => current,
  };
  try {
    const hydrated = await hydrateOrganizationGroupNames(input);
    expect(hydrated.groups.map((group) => group.name).sort()).toEqual([
      "Admins",
      "Members",
      "Operators",
    ]);
    expect(fullReads).toBe(0);
    expect(await f.db.select().from(principalPolicies)).toEqual([]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toHaveLength(
      2,
    );
    const isolated = await hydrateOrganizationGroupNames({
      ...input,
      readEncryptedName: async () => {
        throw new GroupMetadataUnreadableError(
          signed.operatorsPolicy.currentState.principalId,
          new Error("AEAD"),
        );
      },
    });
    expect(
      isolated.groups.find(
        (group) =>
          group.groupId === signed.operatorsPolicy.currentState.principalId,
      ),
    ).toMatchObject({ name: "", nameUnreadable: true });
    await expect(
      hydrateOrganizationGroupNames({
        ...input,
        directory: {
          ...input.directory,
          groups: input.directory.groups.map((group) => ({
            ...group,
            currentState: { ...group.currentState, stateHash: "forged" },
          })),
        },
      }),
    ).rejects.toThrow("Group listing does not match");
    current = false;
    await expect(hydrateOrganizationGroupNames(input)).rejects.toThrow(
      "generation expired",
    );
    expect(fullReads).toBe(0);
  } finally {
    f.close();
  }
});
