import { expect, test } from "bun:test";
import { createCurrentOrganizationRuntimeFixture } from "../../../test/helpers/currentOrganizationRuntime";
import { createInternalRuntimeFixture } from "../../../test/helpers/internalRuntimeFixtures";
import { hydrateOrganizationGroupNamesForRuntime } from "./organizationGroupNameHydration";

test("runtime group labels use bounded policy recovery through private custody", async () => {
  const f = await createCurrentOrganizationRuntimeFixture();
  try {
    const organizationId = f.signed.artifacts.organizationId;
    const directory = {
      directory: {
        organizationId,
        currentUser: { isOrgAdmin: true },
        users: [],
        profileDocumentId: null,
      },
      groups: [f.signed.admin, f.signed.advanced].map((bundle) => ({
        organizationId,
        groupId: bundle.currentState.principalId,
        createdAt: bundle.currentState.createdAt,
        isBuiltin: true,
        name: "Untrusted name",
        nameUnreadable: false,
        currentState: bundle.currentState,
      })),
      memberGroupId: f.signed.members.currentState.principalId,
      readModelCursor: "cursor",
    };
    const result = await hydrateOrganizationGroupNamesForRuntime(
      createInternalRuntimeFixture(() => f.runtime),
      { organizationId, userId: "founder", runtime: f.runtime },
      f.runtime.state.domainScope,
      directory,
    );
    expect(result?.groups.map((group) => group.name).sort()).toEqual([
      "Admins",
      "Members",
    ]);
    expect(f.fullReads()).toBe(0);
    expect(f.requests.length).toBeGreaterThan(0);
  } finally {
    f.close();
  }
});
