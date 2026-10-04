import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import {
  loadOrganizationGroups,
  registerAndAuthenticate,
} from "../../../test/helpers/principalPolicyReadFixtures";
import { createRequestLifetimeBindings } from "../../middleware/requestLifetime";
import { routeApp } from "../../routeApp";

test("history verification opts in through shared workflows, including indirect organization reads", async () => {
  const actor = createTestUser();
  await registerAndAuthenticate(actor);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, actor.userId));
  if (!user) throw new Error("Expected registered user");
  const organizationId = user.defaultOrganizationId;
  const { adminGroupId } = await loadOrganizationGroups(organizationId);
  for (const [path, status, overrides] of [
    [`/organizations/${organizationId}/data-usage`, 200, [0]],
    [
      `/organizations/${organizationId}/groups/${adminGroupId}/members`,
      200,
      [0],
    ],
    [`/organizations/${organizationId}/read-model`, 200, [0]],
    [`/principals/group/${adminGroupId}/policy`, 200, [0]],
    ["/organizations/invalid/data-usage", 400, []],
    ["/auth/sessions", 200, []],
  ] as const) {
    const request = new Request(`http://localhost${path}`, {
      headers: { Authorization: `Bearer ${actor.token}` },
    });
    const timeouts: number[] = [];
    const response = await routeApp.fetch(
      request,
      createRequestLifetimeBindings(request, {
        timeout(actual, seconds) {
          expect(actual).toBe(request);
          timeouts.push(seconds);
        },
      }),
    );
    expect(response.status).toBe(status);
    expect(timeouts).toEqual([...overrides]);
  }
});
