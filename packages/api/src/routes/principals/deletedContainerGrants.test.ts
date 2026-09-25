import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { grantContainerThroughReadGroup } from "../../../test/helpers/containerGroupGrant";
import { createChildContainerFixture } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { deleteGroupRequest } from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { signGroupSuccessor } from "../../../test/helpers/rotatedReadGroupGrant";
import { getCurrentAccessManifestHeads } from "../../access/read/accessManifestStore";
import { routeApp } from "../../routeApp";

async function grantedChild() {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainerFixture({
    parent: { bundle: root.bundle, kekState: root.kekState },
    signer: owner,
  });
  const containerId = child.response.containerId;
  const { groupId } = await grantContainerThroughReadGroup({
    actor: owner,
    container: {
      bundle: accessManifestFromContainerResponse(child.response),
      kekState: kekStateFromContainerResponse(child.response),
      plaintextKek: child.plaintextKek,
    },
    parentKekState: root.kekState,
    parentPath: [root.bundle],
  });
  const remove = async () => {
    const response = await routeApp.request(`/containers/${containerId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status, await response.clone().text()).toBe(200);
  };
  return { owner, organizationId, containerId, groupId, remove };
}

test.each(["retain", "drop"] as const)(
  "a group can rotate and %s its signed grant after container deletion",
  async (mode) => {
    const fixture = await grantedChild();
    const { owner, organizationId, containerId, groupId } = fixture;
    const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    const next = await signGroupSuccessor({
      actor: owner,
      current,
      grants: mode === "retain" ? current.grants : [],
    });
    const submit = () =>
      submitOrganizationGroupPolicyCommit({
        actor: owner,
        groupId,
        organizationId,
        groupPolicy: next.request,
      });
    // An unsigned omission from the client's plan cannot skip a live grant.
    expect((await submit()).status).toBe(409);
    await fixture.remove();
    const response = await submit();
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (await loadVerifiedPrincipalPolicy(db, "group", groupId)).stateHash,
    ).toBe(next.policy.stateHash);
    expect(
      (await getCurrentAccessManifestHeads("container", [containerId], db)).has(
        containerId,
      ),
    ).toBe(true);
  },
);

test("retired container grants do not prevent group deletion", async () => {
  const fixture = await grantedChild();
  const { owner, organizationId, groupId } = fixture;
  const removeGroup = () =>
    deleteGroupRequest({ actor: owner, organizationId, groupId });
  expect((await removeGroup()).status).toBe(409);
  await fixture.remove();
  const response = await removeGroup();
  expect(response.status, await response.clone().text()).toBe(200);
});

test("a missing grant target is not treated as a deleted container", async () => {
  const fixture = await grantedChild();
  const { owner, organizationId, groupId } = fixture;
  await fixture.remove();
  const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  const next = await signGroupSuccessor({
    actor: owner,
    current,
    grants: [{ containerId: crypto.randomUUID(), accessLevel: "read" }],
  });
  const response = await submitOrganizationGroupPolicyCommit({
    actor: owner,
    groupId,
    organizationId,
    groupPolicy: next.request,
  });
  expect(response.status).toBe(409);
  expect(
    (await loadVerifiedPrincipalPolicy(db, "group", groupId)).stateHash,
  ).toBe(current.stateHash);
});

test.each(["changed", "new", "foreign"] as const)(
  "a deleted container cannot acquire a %s group grant",
  async (mode) => {
    const fixture = await grantedChild();
    const { owner, organizationId, groupId } = fixture;
    await fixture.remove();
    let current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    if (mode === "new") {
      const drop = await signGroupSuccessor({
        actor: owner,
        current,
        grants: [],
      });
      expect(
        (
          await submitOrganizationGroupPolicyCommit({
            actor: owner,
            organizationId,
            groupId,
            groupPolicy: drop.request,
          })
        ).status,
      ).toBe(200);
      current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
    }
    let containerId = fixture.containerId;
    if (mode === "foreign") {
      const foreign = await grantedChild();
      await foreign.remove();
      containerId = foreign.containerId;
    }
    const next = await signGroupSuccessor({
      actor: owner,
      current,
      grants: [
        { containerId, accessLevel: mode === "changed" ? "admin" : "read" },
      ],
    });
    const response = await submitOrganizationGroupPolicyCommit({
      actor: owner,
      organizationId,
      groupId,
      groupPolicy: next.request,
    });
    expect(response.status).toBe(409);
    expect(
      (await loadVerifiedPrincipalPolicy(db, "group", groupId)).stateHash,
    ).toBe(current.stateHash);
  },
);
