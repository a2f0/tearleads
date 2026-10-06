import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { principalMembershipProjection } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { PrincipalPolicyPageResponseSchema } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { seedLongPrincipalHistory } from "../../../test/helpers/longPrincipalHistory";
import { getDefaultOrganizationId } from "../../../test/helpers/organizationMembership";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { routeApp } from "../../routeApp";

async function getPage(actor: TestUser, principalId: string, query = "") {
  for (let attempt = 0; attempt < 12; attempt++) {
    const response = await routeApp.request(
      `/principals/organization/${principalId}/policy${query}`,
      {
        headers: { Authorization: `Bearer ${actor.token}` },
      },
    );
    if (response.status !== 202) return response;
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  throw new Error("Fixture preparation did not converge");
}

test("policy pages remain pinned after a concurrent update and verify live authorization", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);
  const organizationId = await getDefaultOrganizationId(owner.userId);
  const initial = PrincipalPolicyPageResponseSchema.parse(
    await (await getPage(owner, organizationId)).json(),
  );
  const head = await seedLongPrincipalHistory({
    actor: owner,
    policy: initial,
    throughVersion: 65,
  });
  const firstResponse = await getPage(owner, organizationId);
  expect(firstResponse.status).toBe(200);
  expect(firstResponse.headers.get("Cache-Control")).toBe("private, no-store");
  const first = PrincipalPolicyPageResponseSchema.parse(
    await firstResponse.json(),
  );
  expect(first.currentState.stateHash).toBe(head.stateHash);
  expect(first.historyPage.nextAfterVersion).toBe(32);
  const next = await seedLongPrincipalHistory({
    actor: owner,
    policy: { ...initial, currentState: head },
    throughVersion: 66,
  });
  const query = `?afterVersion=32&stateHash=${head.stateHash}`;
  const secondResponse = await getPage(owner, organizationId, query);
  expect(secondResponse.status, await secondResponse.clone().text()).toBe(200);
  const second = PrincipalPolicyPageResponseSchema.parse(
    await secondResponse.json(),
  );
  expect(second.currentState).toEqual(first.currentState);
  expect(second.currentPayload).toEqual(first.currentPayload);
  expect(second.currentMemberEnvelopes).toEqual(first.currentMemberEnvelopes);
  expect(second.previousStates.map(({ state }) => state.version)).toEqual(
    Array.from({ length: 32 }, (_, index) => index + 33),
  );
  expect(second.historyPage.nextAfterVersion).toBeNull();

  // Warm both prefixes, then corrupt only the newer live projection. Serving
  // the older valid pin must not skip verification of current authorization.
  await db
    .update(principalMembershipProjection)
    .set({ role: "member" })
    .where(
      and(
        eq(principalMembershipProjection.principalId, organizationId),
        eq(principalMembershipProjection.stateHash, next.stateHash),
        eq(principalMembershipProjection.userId, owner.userId),
      ),
    );
  const corrupted = await getPage(owner, organizationId, query);
  expect(corrupted.status).toBe(409);
  expect(await corrupted.json()).toEqual(
    expect.objectContaining({ error: expect.stringContaining("projection") }),
  );
}, 30_000);
