import { afterAll, beforeAll, expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import { createRouteApp, routeApp } from "../../routeApp";

/**
 * Route-level coverage for the direct Stripe checkout endpoints. The test
 * environment has no Stripe configuration, so these exercise the auth /
 * admin / fail-closed edges — the Stripe and RevenueCat interactions are unit
 * tested in billing/ and services/billing/ with injected fetch.
 */

// These tests exercise the UNCONFIGURED edges; a developer shell exporting
// real Stripe/RevenueCat credentials must not make them hit live APIs.
const ISOLATED_ENV_KEYS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_SYNC_SOLO_PRICE_ID",
  "STRIPE_SYNC_TEAM_5_PRICE_ID",
  "STRIPE_SYNC_TEAM_10_PRICE_ID",
  "REVENUECAT_V2_SECRET_KEY",
  "REVENUECAT_PROJECT_ID",
  "REVENUECAT_STRIPE_PUBLIC_API_KEY",
];
const savedEnv = new Map<string, string | undefined>();

beforeAll(() => {
  for (const key of ISOLATED_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of ISOLATED_ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

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

test("an already-active organization cannot start another checkout", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // A second confirmed checkout would create a second Stripe subscription for
  // the same org — double billing — so eligibility is refused up front, before
  // any Stripe configuration is even consulted.
  await db
    .update(organizationBilling)
    .set({ status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout`,
    { method: "POST", headers: authHeader(admin) },
  );
  expect(response.status).toBe(409);
});

test("a trialing organization may start a checkout (pay before the trial ends)", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // A trial is a local status with no subscription yet, so committing early is
  // not a duplicate purchase. Eligibility must pass — the request reaches the
  // Stripe layer and fails only on this test env's missing config (503), NOT
  // the 409 an active org gets.
  await db
    .update(organizationBilling)
    .set({ status: "trialing" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout`,
    { method: "POST", headers: authHeader(admin) },
  );
  expect(response.status).toBe(503);
});

test("cancel requires authentication", async () => {
  const response = await routeApp.request(
    "/organizations/11111111-1111-4111-8111-111111111111/billing/stripe/cancel",
    { method: "POST" },
  );
  expect(response.status).toBe(401);
});

test("cancel rejects a non-admin of the organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const outsider = createTestUser();
  await registerAndAuthenticate(outsider);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/cancel`,
    { method: "POST", headers: authHeader(outsider) },
  );
  expect([403, 404]).toContain(response.status);
});

test("cancel answers 404 for an admin with no cancellable subscription", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/cancel`,
    { method: "POST", headers: authHeader(admin) },
  );
  // Unconfigured / no Stripe subscription: an admin-actionable "nothing to
  // cancel", not an empty 200.
  expect(response.status).toBe(404);
});

test("checkout-session requires authentication", async () => {
  const response = await routeApp.request(
    "/organizations/11111111-1111-4111-8111-111111111111/billing/stripe/checkout-session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ returnUrl: "https://app.example/billing" }),
    },
  );
  expect(response.status).toBe(401);
});

test("checkout-session wraps the service result in a 200 { url } body", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout-session`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      body: JSON.stringify({ returnUrl: "https://app.example/billing" }),
    },
  );
  // Unconfigured in this env, so the URL is null — but the route still wraps it
  // in { url } with a 200, the shape the client validator requires.
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: null });
});

test("checkout-session 409s for an already-active organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // The eligibility guard runs before any Stripe call and propagates its 409
  // through withReturnUrl/respondForOrganization — a second subscription would
  // double-bill.
  await db
    .update(organizationBilling)
    .set({ status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout-session`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      body: JSON.stringify({ returnUrl: "https://app.example/billing" }),
    },
  );
  expect(response.status).toBe(409);
});

test("checkout-session rejects a non-http returnUrl", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

  // The success/cancel URLs are redirect targets, so only http(s) is accepted
  // — this guard holds even under the dev wildcard origin allowlist.
  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/checkout-session`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      body: JSON.stringify({ returnUrl: "ftp://app.example/billing" }),
    },
  );
  expect(response.status).toBe(400);
});

test("options answer an empty list when unconfigured", async () => {
  const user = createTestUser();
  const organizationId = await registerAndAuthenticate(user);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/options`,
    { headers: authHeader(user) },
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ options: [] });
});

test("options reject an already-active organization before configuration", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await db
    .update(organizationBilling)
    .set({ status: "active" })
    .where(eq(organizationBilling.organizationId, organizationId));

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/options`,
    { headers: authHeader(admin) },
  );

  expect(response.status).toBe(409);
});

test("options reject an organization above the largest tier", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  for (let index = 0; index < 10; index += 1) {
    await addEffectiveOrganizationMember(organizationId, crypto.randomUUID());
  }

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/options`,
    { headers: authHeader(admin) },
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code: "billing_roster_over_capacity",
    error:
      "The organization exceeds the maximum subscription tier of 10 members",
  });
});

test("options reject a caller outside the organization", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const outsider = createTestUser();
  await registerAndAuthenticate(outsider);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/options`,
    { headers: authHeader(outsider) },
  );

  expect([403, 404]).toContain(response.status);
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

test("the portal refuses return urls outside the app's origins", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  // The route resolves its allowlist from the composition root, so build an
  // app with explicit origins — exactly how production wires it.
  const app = createRouteApp(
    {},
    { corsOrigins: ["https://app.tearleads.example"] },
  );

  // billing.stripe.com redirects to returnUrl verbatim; a foreign origin
  // would turn the portal into an open redirect.
  const rejected = await app.request(
    `/organizations/${organizationId}/billing/stripe/portal`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      body: JSON.stringify({ returnUrl: "https://evil.example/phish" }),
    },
  );
  expect(rejected.status).toBe(400);

  // An allowlisted origin passes URL validation (and then answers a null
  // portal, since the org has no Stripe subscription).
  const allowed = await app.request(
    `/organizations/${organizationId}/billing/stripe/portal`,
    {
      method: "POST",
      headers: { ...authHeader(admin), "Content-Type": "application/json" },
      body: JSON.stringify({
        returnUrl: "https://app.tearleads.example/billing",
      }),
    },
  );
  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toEqual({ portalUrl: null });
});

test("the Stripe webhook fails closed without its signing secret", async () => {
  const response = await routeApp.request("/billing/stripe/webhook", {
    method: "POST",
    body: "{}",
  });
  expect(response.status).toBe(503);
});
