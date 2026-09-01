import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { createServiceTestRuntime } from "../../../test/helpers/serviceRuntime";
import { routeApp } from "../../routeApp";
import { runOrganizationPurgeMaintenance } from "../../services/billing/organizationPurge";

async function registerAuthenticatedUser(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);
  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));
  invariant(row, "expected registered user");
  return row.organizationId;
}

function authorization(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

test("a retained roster member can observe purged after access-plane deletion", async () => {
  const owner = createTestUser();
  const organizationId = await registerAuthenticatedUser(owner);
  const outsider = createTestUser();
  await registerAuthenticatedUser(outsider);
  const now = new Date("2099-08-29T12:00:00.000Z");
  await db
    .update(organizationBilling)
    .set({
      disabledAt: new Date(now.getTime() - 2_000),
      purgeAfter: new Date(now.getTime() - 1_000),
      status: "disabled",
    })
    .where(eq(organizationBilling.organizationId, organizationId));

  expect(
    await runOrganizationPurgeMaintenance(createServiceTestRuntime(), {
      now,
      organizationIds: [organizationId],
    }),
  ).toEqual({ claimed: 1, failed: 0, purged: 1 });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authorization(owner) },
  );
  expect(response.status).toBe(200);
  const billing = await response.json();
  invariant(
    isOrganizationBillingResponse(billing),
    "expected billing response",
  );
  expect(billing.status).toBe("purged");

  const denied = await routeApp.request(
    `/organizations/${organizationId}/billing`,
    { headers: authorization(outsider) },
  );
  expect(denied.status).toBe(403);
});
