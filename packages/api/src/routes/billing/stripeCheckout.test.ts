import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

/**
 * Route-level coverage for the direct Stripe checkout endpoints. The test
 * environment has no Stripe configuration, so these exercise the auth /
 * admin / fail-closed edges — the Stripe and RevenueCat interactions are unit
 * tested in billing/ and services/billing/ with injected fetch.
 */

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

test("checkout requires authentication", async () => {
  const response = await routeApp.request(
    "/organizations/11111111-1111-4111-8111-111111111111/billing/stripe/checkout",
    { method: "POST" },
  );
  expect(response.status).toBe(401);
});

test("checkout rejects a non-admin of the organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const outsider = createTestUser();
  await registerAndAuthenticate(outsider);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout`,
    { method: "POST", headers: authHeader(outsider) },
  );
  expect([403, 404]).toContain(response.status);
});

test("an unconfigured checkout answers 503 for an admin, not an empty body", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout`,
    { method: "POST", headers: authHeader(admin) },
  );
  expect(response.status).toBe(503);
});

test("options answer an empty list when unconfigured", async () => {
  const user = createTestUser();
  await registerAndAuthenticate(user);

  const response = await routeApp.request("/billing/stripe/options", {
    headers: authHeader(user),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ options: [] });
});

test("the portal validates its return url", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/portal`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      // A javascript: URL must never round-trip into a browser redirect.
      body: JSON.stringify({ returnUrl: "javascript:alert(1)" }),
    },
  );
  expect(response.status).toBe(400);
});

test("the Stripe webhook fails closed without its signing secret", async () => {
  const response = await routeApp.request("/billing/stripe/webhook", {
    method: "POST",
    body: "{}",
  });
  expect(response.status).toBe(503);
});
