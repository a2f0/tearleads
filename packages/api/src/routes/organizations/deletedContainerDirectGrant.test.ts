import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { createChildContainerFixture } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { removeMemberGroupUser } from "../../../test/helpers/organizationMember";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

test("a deleted folder direct grant does not block roster removal", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticate(owner, member);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainerFixture({
    parent: { bundle: root.bundle, kekState: root.kekState },
    signer: owner,
  });
  const childBundle = accessManifestFromContainerResponse(child.response);
  const childKek = kekStateFromContainerResponse(child.response);
  const share = await routeApp.request(
    `/containers/${childKek.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildContainerGrantRequest({
          accessLevel: "read",
          parentKekState: root.kekState,
          previous: childBundle,
          previousContainerPath: [root.bundle, childBundle],
          previousKekState: childKek,
          recipient: member,
          signer: owner,
        }),
      ),
    },
  );
  expect(share.status).toBe(200);
  const deleted = await routeApp.request(
    `/containers/${childKek.containerId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(deleted.status).toBe(200);
  const error = await removeMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  }).then(
    () => null,
    (caught: unknown) => String(caught),
  );
  expect(error).toBeNull();
});
