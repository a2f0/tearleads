import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { readTestGroupName } from "../../../test/helpers/groupMetadata";
import { createGroupNameDirectory } from "../../../test/helpers/groupNameDirectory";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { hydrateOrganizationGroupNames } from "./organizationGroupNames";

test("directory labels are decrypted only at their authenticated group heads", async () => {
  const { close, execSql } = await createTestExecSql("group-name-hydration");
  try {
    const fixture = await createGroupNameDirectory();
    const organizationId = fixture.author.organizationId;
    const directory = {
      directory: {
        organizationId,
        currentUser: { isOrgAdmin: true },
        users: [],
        profileDocumentId: null,
      },
      groups: Object.values(fixture.servedGroups).map((bundle) => ({
        organizationId,
        groupId: bundle.currentState.principalId,
        createdAt: bundle.currentState.createdAt,
        isBuiltin: bundle.currentState.principalId !== "group-1",
        name: "Untrusted feed label",
        currentState: {
          ...bundle.currentState,
          memberCount: bundle.currentProjection.length,
        },
      })),
      memberGroupId: "members-group",
      readModelCursor: "cursor-1",
    };
    const input = {
      ...fixture,
      directory,
      execSql,
      organizationId,
      readEncryptedName: readTestGroupName,
      stillCurrent: () => true,
    };
    const signature = fixture.operatorsPolicy.currentState.signature;
    fixture.operatorsPolicy.currentState.signature =
      fixture.memberPolicy.currentState.signature;
    await expect(hydrateOrganizationGroupNames(input)).rejects.toThrow();
    fixture.operatorsPolicy.currentState.signature = signature;
    const hydrated = await hydrateOrganizationGroupNames(input);
    expect(hydrated.groups.map((group) => group.name).sort()).toEqual([
      "Admins",
      "Members",
      "Operators",
    ]);
    await expect(
      hydrateOrganizationGroupNames({
        ...input,
        directory: {
          ...directory,
          groups: directory.groups.map((group) => ({
            ...group,
            currentState: { ...group.currentState, stateHash: "forged-head" },
          })),
        },
      }),
    ).rejects.toThrow("Group listing does not match the signed directory");
    await expect(
      hydrateOrganizationGroupNames({ ...input, stillCurrent: () => false }),
    ).rejects.toThrow();
    const organization = await fixture.apiClient.getCurrentPrincipalPolicy(
      "organization",
      organizationId,
    );
    if (!organization) throw new Error("Expected signed organization");
    const organizationPolicyReference = principalPolicyHead(organization);
    fixture.fetched.length = 0;
    await expect(
      hydrateOrganizationGroupNames({ ...input, organizationPolicyReference }),
    ).resolves.toEqual(hydrated);
    expect(fixture.fetched).toEqual([]);
    await expect(
      hydrateOrganizationGroupNames({
        ...input,
        organizationPolicyReference: {
          ...organizationPolicyReference,
          stateHash: "forged-org-head",
        },
      }),
    ).rejects.toThrow();
  } finally {
    close();
  }
});
