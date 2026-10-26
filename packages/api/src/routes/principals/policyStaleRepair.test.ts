import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import type { PrincipalPolicyRef } from "@tearleads/validators/request";
import { isPrincipalPolicyStaleErrorResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { createGroupRequest } from "../../../test/helpers/organizationGroup";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import {
  loadOrganizationGroups,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

// A stale-policy 409 returns the current heads so the client can repair its
// mutation. That reject runs before the mutation's own authorization, so it
// must serve only heads the requester could read through GET; otherwise a
// fabricated stale entry naming any principal is an unauthorized read.

/** A well-formed citation of the group that names a superseded state. */
async function staleRefFor(groupId: string): Promise<PrincipalPolicyRef> {
  const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  return {
    principalType: "group",
    principalId: groupId,
    version: current.version + 1,
    stateHash: "0".repeat(64),
  };
}

/** Shares `actor`'s own root, citing a stale head for `groupId`. */
async function shareOwnRootCiting(
  actor: TestUser,
  recipient: TestUser,
  groupIds: string | string[],
): Promise<Response> {
  const root = await bootstrapRoot(actor);
  const request = await buildRootGrantRequest({
    previous: root.bundle,
    previousKekState: root.kekState,
    recipient,
    signer: actor,
  });
  return routeApp.request(`/containers/${root.kekState.containerId}/share`, {
    body: JSON.stringify({
      ...request,
      principalPolicyRefs: [
        ...request.principalPolicyRefs,
        ...(await Promise.all(
          (typeof groupIds === "string" ? [groupIds] : groupIds).map(
            staleRefFor,
          ),
        )),
      ],
    }),
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

test("a stale-policy reject returns only heads the requester may read", async () => {
  const victim = createTestUser();
  const attacker = createTestUser();
  const bystander = createTestUser();
  await registerAndAuthenticate(victim, attacker, bystander);
  const { adminGroupId: victimAdminGroupId } = await loadOrganizationGroups(
    await getDefaultOrganizationId(victim.userId),
  );

  const response = await shareOwnRootCiting(
    attacker,
    bystander,
    victimAdminGroupId,
  );

  expect(response.status, await response.clone().text()).toBe(409);
  const body: unknown = await response.json();
  invariant(isPrincipalPolicyStaleErrorResponse(body), "expected stale reject");
  expect(body.principalHeads.map((head) => head.principalId)).toEqual([]);
});

test("a stale-policy reject still repairs a head the requester may read", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner, peer);
  const { adminGroupId } = await loadOrganizationGroups(
    await getDefaultOrganizationId(owner.userId),
  );

  const response = await shareOwnRootCiting(owner, peer, adminGroupId);

  expect(response.status, await response.clone().text()).toBe(409);
  const body: unknown = await response.json();
  invariant(isPrincipalPolicyStaleErrorResponse(body), "expected stale reject");
  expect(body.principalHeads.map((head) => head.principalId)).toEqual([
    adminGroupId,
  ]);
});

test("stale-policy replies cap distinct readable heads at sixteen", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner, peer);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const groupIds: string[] = [];
  for (let index = 0; index < 17; index++) {
    const groupId = crypto.randomUUID();
    const response = await routeApp.request(
      `/organizations/${organizationId}/groups`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${owner.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          await createGroupRequest({
            actor: owner,
            groupId,
            name: `Repair ${index}`,
          }),
        ),
      },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    groupIds.push(groupId);
  }
  const response = await shareOwnRootCiting(owner, peer, groupIds);
  expect(response.status).toBe(409);
  const body: unknown = await response.json();
  invariant(isPrincipalPolicyStaleErrorResponse(body), "expected stale reject");
  expect(body.principalHeads.map((head) => head.principalId)).toEqual(
    groupIds.slice(0, 16),
  );
  const remainder = await shareOwnRootCiting(owner, peer, groupIds.slice(16));
  const remainderBody: unknown = await remainder.json();
  invariant(
    isPrincipalPolicyStaleErrorResponse(remainderBody),
    "expected remaining repair",
  );
  expect(remainderBody.principalHeads.map((head) => head.principalId)).toEqual(
    groupIds.slice(16),
  );
}, 30_000);
