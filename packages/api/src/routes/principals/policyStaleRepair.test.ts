import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import {
  bootstrapRoot,
  buildRootGrantRequest,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { loadVerifiedPrincipalPolicy } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

// A stale-policy 409 returns the current bundles so the client can repair its
// mutation. That reject runs before the mutation's own authorization, so it
// must serve only bundles the requester could read through GET; otherwise a
// fabricated stale entry naming any principal is an unauthenticated read.

async function registerAndAuthenticate(...users: TestUser[]): Promise<void> {
  for (const user of users) {
    await registerUser(user);
    await authenticate(user);
  }
}

async function loadAdminGroupId(organizationId: string): Promise<string> {
  const [organization] = await db
    .select({ adminGroupId: organizations.adminGroupId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  invariant(organization, "expected organization row");
  return organization.adminGroupId;
}

/** A well-formed artifact for the group that names a superseded state. */
async function staleArtifactFor(
  groupId: string,
): Promise<Record<string, unknown>> {
  const current = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  const version = current.version + 1;
  const stateHash = "0".repeat(64);
  const { createdAt: _createdAt, ...signedState } =
    current.state as unknown as Record<string, unknown>;
  return {
    principalType: "group",
    principalId: groupId,
    version,
    keyEpoch: current.keyEpoch,
    stateHash,
    state: { ...signedState, stateHash, version },
    projection: current.projection,
    grants: current.grants,
    checkpoint: { ...current.checkpoint, stateHash, version },
  };
}

/** Shares `actor`'s own root, citing a stale artifact for `groupId`. */
async function shareOwnRootCiting(
  actor: TestUser,
  recipient: TestUser,
  groupId: string,
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
      principalPolicies: [
        ...request.principalPolicies,
        await staleArtifactFor(groupId),
      ],
    }),
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

test("a stale-policy reject returns only bundles the requester may read", async () => {
  const victim = createTestUser();
  const attacker = createTestUser();
  const bystander = createTestUser();
  await registerAndAuthenticate(victim, attacker, bystander);
  const victimAdminGroupId = await loadAdminGroupId(
    await getDefaultOrganizationId(victim.userId),
  );

  const response = await shareOwnRootCiting(
    attacker,
    bystander,
    victimAdminGroupId,
  );

  expect(response.status, await response.clone().text()).toBe(409);
  const body = (await response.json()) as {
    code: string;
    principalPolicies: PrincipalPolicyBundleResponse[];
  };
  expect(body.code).toBe("principal_policy_stale");
  expect(
    body.principalPolicies.map((bundle) => bundle.currentState.principalId),
  ).toEqual([]);
});

test("a stale-policy reject still repairs a bundle the requester may read", async () => {
  const owner = createTestUser();
  const peer = createTestUser();
  await registerAndAuthenticate(owner, peer);
  const adminGroupId = await loadAdminGroupId(
    await getDefaultOrganizationId(owner.userId),
  );

  const response = await shareOwnRootCiting(owner, peer, adminGroupId);

  expect(response.status, await response.clone().text()).toBe(409);
  const body = (await response.json()) as {
    code: string;
    principalPolicies: PrincipalPolicyBundleResponse[];
  };
  expect(body.code).toBe("principal_policy_stale");
  expect(
    body.principalPolicies.map((bundle) => bundle.currentState.principalId),
  ).toEqual([adminGroupId]);
});
