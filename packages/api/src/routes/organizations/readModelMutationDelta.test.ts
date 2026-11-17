import { expect, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import {
  isCommitOrganizationGroupPolicyResponse,
  isContainerShareResponse,
  isCreateOrganizationGroupResponse,
  isOrganizationReadModelResponse,
  type OrganizationReadModelDeltaResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { buildContainerGrantRequest } from "../../../test/helpers/containerGrantMutation";
import { createChildContainerFixture } from "../../../test/helpers/keyingWriterProjectionChild";
import {
  accessManifestFromContainerResponse,
  bootstrapRoot,
  kekStateFromContainerResponse,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadOrganizationReadModelSnapshot } from "../../../test/helpers/organizationReadModel";
import { requestPreparedPrincipalPolicy } from "../../../test/helpers/principalHistoryRequest";
import { registerAndAuthenticateUsers } from "../../../test/helpers/principalPolicyReadFixtures";
import { requestAfterPrincipalPreparation } from "../../../test/helpers/principalPreparationRequest";
import { routeApp } from "../../routeApp";

function withHeldCursor(path: string, cursor: string): string {
  return `${path}?${new URLSearchParams({ readModelCursor: cursor }).toString()}`;
}

async function readFeed(
  actor: TestUser,
  organizationId: string,
  cursor: string,
): Promise<OrganizationReadModelDeltaResponse> {
  const response = await routeApp.request(
    `/organizations/${organizationId}/read-model?${new URLSearchParams({ cursor }).toString()}`,
    { headers: { Authorization: `Bearer ${actor.token}` } },
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  invariant(
    isOrganizationReadModelResponse(body) && body.mode === "delta",
    "expected a feed delta",
  );
  return body;
}

async function createGroup(
  actor: TestUser,
  organizationId: string,
  heldCursor: string,
) {
  const response = await requestAfterPrincipalPreparation(
    withHeldCursor(`/organizations/${organizationId}/groups`, heldCursor),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor,
          groupId: crypto.randomUUID(),
          name: "Operators",
        }),
      ),
    },
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  invariant(isCreateOrganizationGroupResponse(body), "expected group");
  return body;
}

/** Adds `member` to Members, sending `heldCursor`, and returns each answer. */
async function addMember(input: {
  readonly actor: TestUser;
  readonly heldCursor: string;
  readonly member: TestUser;
  readonly organizationId: string;
  readonly replay?: boolean;
}) {
  const responses: unknown[] = [];
  await addMemberGroupUser({
    actor: input.actor,
    memberUserId: input.member.userId,
    organizationId: input.organizationId,
    request: async (path, init) => {
      const heldPath = withHeldCursor(path, input.heldCursor);
      const sends = input.replay ? 2 : 1;
      let response = new Response(null, { status: 500 });
      for (let send = 0; send < sends; send += 1) {
        response = await requestPreparedPrincipalPolicy(heldPath, init);
        responses.push(await response.clone().json());
      }
      return response;
    },
  });
  return responses.map((body) => {
    invariant(
      isCommitOrganizationGroupPolicyResponse(body),
      "expected group policy commit",
    );
    return body;
  });
}

test("a group create and a member add carry the feed's own delta", async () => {
  const actor = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticateUsers(actor, member);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const snapshot = await loadOrganizationReadModelSnapshot(
    actor,
    organizationId,
  );

  // A group write stamps the cursor twice; the delta reaches the last stamp.
  const created = await createGroup(actor, organizationId, snapshot.nextCursor);
  invariant(created.readModel, "expected the committer's delta");
  expect(created.readModel).toEqual(
    await readFeed(actor, organizationId, snapshot.nextCursor),
  );
  expect(Object.keys(created.readModel.lanes).sort()).toEqual([
    "groupMemberships",
    "groups",
    "organizationPolicy",
  ]);

  const [added, replayed] = await addMember({
    actor,
    heldCursor: created.readModel.nextCursor,
    member,
    organizationId,
    replay: true,
  });
  invariant(added?.readModel, "expected the committer's delta");
  expect(added.readModel).toEqual(
    await readFeed(actor, organizationId, created.readModel.nextCursor),
  );
  expect(
    added.readModel.lanes.directory?.users.map((user) => user.userId),
  ).toEqual(expect.arrayContaining([actor.userId, member.userId]));
  // A replay stamps nothing, so it carries no delta.
  expect(replayed).toEqual({ ...added, readModel: undefined });
  expect(replayed && "readModel" in replayed).toBe(false);
});

test("a held cursor behind or beside the head the commit advanced from earns no delta", async () => {
  const actor = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticateUsers(actor, member);
  const organizationId = await getDefaultOrganizationId(actor.userId);
  const snapshot = await loadOrganizationReadModelSnapshot(
    actor,
    organizationId,
  );
  const created = await createGroup(actor, organizationId, snapshot.nextCursor);
  invariant(created.readModel, "expected the committer's delta");

  // The snapshot cursor is now one commit behind the head.
  const [stale] = await addMember({
    actor,
    heldCursor: snapshot.nextCursor,
    member,
    organizationId,
  });
  expect(stale && "readModel" in stale).toBe(false);

  const other = createTestUser();
  await registerAndAuthenticateUsers(other);
  const otherOrganizationId = await getDefaultOrganizationId(other.userId);
  const otherSnapshot = await loadOrganizationReadModelSnapshot(
    other,
    otherOrganizationId,
  );
  for (const heldCursor of [otherSnapshot.nextCursor, "not-a-cursor"]) {
    const unrelated = await createGroup(actor, organizationId, heldCursor);
    expect("readModel" in unrelated).toBe(false);
  }
});

test("a share that stamps grants carries the sharer's delta", async () => {
  const owner = createTestUser();
  const member = createTestUser();
  await registerAndAuthenticateUsers(owner, member);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const root = await bootstrapRoot(owner);
  const child = await createChildContainerFixture({
    parent: { bundle: root.bundle, kekState: root.kekState },
    signer: owner,
  });
  const childBundle = await accessManifestFromContainerResponse(child.response);
  const childKek = await kekStateFromContainerResponse(child.response);
  // Building the grant enrolls the recipient, which advances the head.
  const grant = await buildContainerGrantRequest({
    accessLevel: "read",
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    recipient: member,
    signer: owner,
  });
  const snapshot = await loadOrganizationReadModelSnapshot(
    owner,
    organizationId,
  );
  const response = await routeApp.request(
    withHeldCursor(
      `/containers/${childKek.containerId}/share`,
      snapshot.nextCursor,
    ),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(grant),
    },
  );
  expect(response.status).toBe(200);
  const shared: unknown = await response.json();
  invariant(isContainerShareResponse(shared), "expected share response");
  invariant(shared.readModel, "expected the sharer's delta");
  expect(shared.readModel).toEqual(
    await readFeed(owner, organizationId, snapshot.nextCursor),
  );
  expect(Object.keys(shared.readModel.lanes)).toEqual(["grants"]);
  expect(
    shared.readModel.lanes.grants?.grants.some(
      (grant) =>
        grant.containerId === childKek.containerId &&
        grant.subjectId === member.userId,
    ),
  ).toBe(true);
});
