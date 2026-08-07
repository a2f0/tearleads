import { expect, test } from "bun:test";
import {
  cancelStripeSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getStripeCheckoutOptionsOperation,
  operationRoutePath,
} from "@tearleads/validators/operation";
import type { MiddlewareHandler } from "hono";
import type { SessionEnv } from "../../middleware/session";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createStripeCheckoutRoute } from "./stripeCheckout";

const operations = [
  getStripeCheckoutOptionsOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  cancelStripeSubscriptionOperation,
] as const;
const organizationId = "11111111-1111-4111-8111-111111111111";

function createTestRoute(requireAuth: MiddlewareHandler<SessionEnv>) {
  return createStripeCheckoutRoute({
    corsOrigins: ["https://app.example"],
    requireAuth,
    runtime: {} as ApiServiceRuntime,
  });
}

test("Stripe checkout routes register from shared operations", () => {
  const route = createTestRoute((_c, next) => next());
  for (const operation of operations) {
    expect(
      route.routes.some(
        ({ method, path }) =>
          method === operation.method && path === operationRoutePath(operation),
      ),
    ).toBe(true);
  }
});

test("Stripe checkout routes authenticate before boundary validation", async () => {
  const route = createTestRoute(async (c) =>
    c.json({ error: "Unauthorized" }, 401),
  );
  for (const [method, suffix] of [
    ["GET", "options"],
    ["POST", "checkout"],
    ["POST", "checkout-session"],
    ["POST", "portal"],
    ["POST", "cancel"],
  ] as const) {
    const response = await route.request(
      `/organizations/invalid/billing/stripe/${suffix}`,
      { ...(method === "POST" ? { body: "{" } : {}), method },
    );
    expect(response.status).toBe(401);
  }
});

test("Stripe checkout routes reject invalid organization ids", async () => {
  const route = createTestRoute((_c, next) => next());
  const requests = [
    route.request("/organizations/invalid/billing/stripe/options"),
    route.request("/organizations/invalid/billing/stripe/checkout", {
      method: "POST",
    }),
    route.request("/organizations/invalid/billing/stripe/cancel", {
      method: "POST",
    }),
    ...["checkout-session", "portal"].map((suffix) =>
      route.request(`/organizations/invalid/billing/stripe/${suffix}`, {
        body: JSON.stringify({ returnUrl: "https://app.example/billing" }),
        method: "POST",
      }),
    ),
  ];

  for (const request of requests) {
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid organizationId" });
  }
});

test("hosted Stripe routes preserve body validation responses and order", async () => {
  const route = createTestRoute((_c, next) => next());
  for (const suffix of ["checkout-session", "portal"]) {
    const invalid = await route.request(
      `/organizations/${organizationId}/billing/stripe/${suffix}`,
      { body: "{}", method: "POST" },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid returnUrl" });

    const malformed = await route.request(
      `/organizations/invalid/billing/stripe/${suffix}`,
      { body: "{", method: "POST" },
    );
    expect(await malformed.json()).toEqual({ error: "Invalid JSON body" });
    expect(malformed.status).toBe(400);
  }
});
