import { expect, test } from "bun:test";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { UnverifiedUserIdentityError } from "../../data/trustedUserIdentity";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
  LINK_USER_ID,
} from "../../data/trustedUserIdentity/identityLink.testFixtures";
import { createTrustedUserIdentityService } from "../../data/trustedUserIdentity/service";
import {
  type ContainerContents,
  createContainerContents,
} from "../containerContents";
import { createOrganizations } from ".";

const ORGANIZATION_ID = "6a1f3c2e-8d4b-4f6a-9c1e-2b3d4e5f6a7b";

// A runtime whose trust store is real: `resolve` pins as signed-state
// verification does on first sight, and `verifyLink` as an identity link does.
async function admissionRuntime(name: string) {
  const database = await createTestExecSql(name);
  const fixture = await identityLinkFixture();
  const trust = createTrustedUserIdentityService({
    getExecSql: () => database.execSql,
    getLocalUserId: () => null,
    getLocalIdentity: () => null,
    identityTrustDomain: LINK_TRUST_DOMAIN,
    remoteSource: { invalidate: () => {}, load: async () => fixture.remote },
  });
  const runtime = createInternalRuntimeFixture(() =>
    createWorkflowInputFixture({
      apiClient: createMockApiClient({}),
      auth: { organizationId: ORGANIZATION_ID, userId: "admin" },
      execSql: database.execSql,
      online: false,
    }),
  );
  Object.assign(runtime, { identityLinks: trust });
  return { ...database, fixture, runtime, trust };
}

test("a group add refuses a member whose pin was only observed", async () => {
  const { close, fixture, runtime, trust } = await admissionRuntime(
    "admission-group-add",
  );
  try {
    const organizations = createOrganizations(
      runtime,
      {} as ContainerContents,
      () => {
        throw new Error("No organization is resumed in this test");
      },
    );
    const add = () =>
      organizations.addUserToGroup({
        expectedGroupName: "Members",
        groupId: "group-1",
        targetUserId: LINK_USER_ID,
      });

    await expect(add()).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
    await trust.resolve(LINK_USER_ID);
    await expect(add()).rejects.toBeInstanceOf(UnverifiedUserIdentityError);

    await trust.verifyLink(fixture.link);
    // Past admission, the fixture lacks signing keys, so the write itself
    // fails for an unrelated reason.
    await expect(add()).rejects.not.toBeInstanceOf(UnverifiedUserIdentityError);
  } finally {
    close();
  }
});

test("a folder share refuses a recipient whose pin was only observed", async () => {
  const { close, fixture, runtime, trust } = await admissionRuntime(
    "admission-user-share",
  );
  try {
    const tree = createContainerContents(runtime).openTree();
    const share = () => tree.shareWithUser("container-1", LINK_USER_ID);

    await expect(share()).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
    await trust.resolve(LINK_USER_ID);
    await expect(share()).rejects.toBeInstanceOf(UnverifiedUserIdentityError);

    await trust.verifyLink(fixture.link);
    // Admitted; the offline store then declines the share without throwing.
    await expect(share()).resolves.toBe(false);
  } finally {
    close();
  }
});
