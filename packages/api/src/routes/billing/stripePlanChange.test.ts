import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createTestUser, type TestUser } from "@tearleads/test-utils";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import {
  readPlanState,
  subscribedOrganization,
} from "../../../test/helpers/stripePlanChangeFixtures";
import { STRIPE_WEBHOOK_ENV as STRIPE_ENV } from "../../../test/helpers/stripeWebhook";
import { createRouteApp } from "../../routeApp";

/**
 * HTTP coverage for `POST /organizations/{id}/billing/stripe/plan`: who may
 * call it and the coded answers an admin acts on. The plan change rules are
 * tested in services/billing/stripePlanChange*.test.ts.
 */

const routeApp = createRouteApp({}, {});
const STRIPE_ENV_KEYS = Object.keys(STRIPE_ENV);
const savedEnv = new Map<string, string | undefined>();

// A developer shell exporting real Stripe credentials must not reach Stripe.
beforeEach(() => {
  for (const key of STRIPE_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of STRIPE_ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

function changeRequest(
  user: TestUser,
  body: { readonly currentSeatCount: number; readonly priceId: string },
): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  };
}

/** Answers Stripe with `fetchImpl` while the request runs. */
async function withStripe(
  fetchImpl: typeof fetch,
  run: () => Response | Promise<Response>,
): Promise<Response> {
  Object.assign(process.env, STRIPE_ENV);
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fetchImpl);
  try {
    return await run();
  } finally {
    fetchSpy.mockRestore();
  }
}

test("changing the plan requires authentication", async () => {
  const response = await routeApp.request(
    "/organizations/11111111-1111-4111-8111-111111111111/billing/stripe/plan",
    {
      body: JSON.stringify({ currentSeatCount: 1, priceId: "price_team_5" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
  );
  expect(response.status).toBe(401);
});

test("only an admin of the organization can change its plan", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const outsider = createTestUser();
  await registerAndAuthenticateWithOrganization(outsider);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/plan`,
    changeRequest(outsider, { currentSeatCount: 1, priceId: "price_team_5" }),
  );
  expect([403, 404]).toContain(response.status);
});

test("an unconfigured plan change answers 503 for an admin", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/stripe/plan`,
    changeRequest(admin, { currentSeatCount: 1, priceId: "price_team_5" }),
  );
  expect(response.status).toBe(503);
});

test("a declined upgrade answers 409 billing_plan_change_payment_failed", async () => {
  const { admin, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });

  const response = await withStripe(stripe(true).fetchImpl, () =>
    routeApp.request(
      `/organizations/${organizationId}/billing/stripe/plan`,
      changeRequest(admin, { currentSeatCount: 5, priceId: "price_team_10" }),
    ),
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "billing_plan_change_payment_failed",
  });
  expect(await readPlanState(organizationId)).toMatchObject({
    billing: { seatCount: 5 },
  });
});

test("a plan that changed since it was shown answers 409 billing_plan_change_unavailable", async () => {
  const { admin, organizationId, stripe } = await subscribedOrganization({
    seatCount: 5,
  });

  const response = await withStripe(stripe().fetchImpl, () =>
    routeApp.request(
      `/organizations/${organizationId}/billing/stripe/plan`,
      changeRequest(admin, { currentSeatCount: 10, priceId: "price_sync" }),
    ),
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "billing_plan_change_unavailable",
  });
  expect(await readPlanState(organizationId)).toMatchObject({
    seats: { desiredRenewalQuantity: 5 },
  });
});
