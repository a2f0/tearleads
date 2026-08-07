import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  billingWebhookWireHeaderNames,
  operationRoutePath,
  receiveRevenueCatWebhookOperation,
  receiveStripeWebhookOperation,
} from "@tearleads/validators/operation";
import type { ApiServiceRuntime } from "../../services/runtime";
import { createRevenueCatWebhookRoute } from "./revenuecatWebhook";
import { createStripeWebhookRoute } from "./stripeWebhook";

const revenueCatSecret = "Bearer revenuecat-test-secret";
const stripeSecret = "whsec_stripe-test-secret";
const revenueCatAuthEnvKey = "REVENUECAT_WEBHOOK_AUTH_HEADER";
const stripeSecretEnvKey = "STRIPE_WEBHOOK_SECRET";

function stripeSignature(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", stripeSecret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

test("billing webhook routes register from shared operations", () => {
  const runtime = {} as ApiServiceRuntime;
  const revenueCat = createRevenueCatWebhookRoute(runtime);
  const stripe = createStripeWebhookRoute(runtime);

  expect(
    revenueCat.routes.some(
      ({ method, path }) =>
        method === receiveRevenueCatWebhookOperation.method &&
        path === operationRoutePath(receiveRevenueCatWebhookOperation),
    ),
  ).toBe(true);
  expect(
    stripe.routes.some(
      ({ method, path }) =>
        method === receiveStripeWebhookOperation.method &&
        path === operationRoutePath(receiveStripeWebhookOperation),
    ),
  ).toBe(true);
});

test("billing webhooks fail closed before parsing when secrets are unset", async () => {
  const previousRevenueCatSecret = process.env[revenueCatAuthEnvKey];
  const previousStripeSecret = process.env[stripeSecretEnvKey];
  delete process.env[revenueCatAuthEnvKey];
  delete process.env[stripeSecretEnvKey];
  try {
    const revenueCat = await createRevenueCatWebhookRoute(
      {} as ApiServiceRuntime,
    ).request(receiveRevenueCatWebhookOperation.path, {
      body: "{",
      method: "POST",
    });
    expect(revenueCat.status).toBe(503);
    expect(await revenueCat.json()).toEqual({
      error: "Webhook not configured",
    });

    const stripe = await createStripeWebhookRoute(
      {} as ApiServiceRuntime,
    ).request(receiveStripeWebhookOperation.path, {
      body: "{",
      method: "POST",
    });
    expect(stripe.status).toBe(503);
    expect(await stripe.json()).toEqual({ error: "Webhook not configured" });
  } finally {
    if (previousRevenueCatSecret === undefined) {
      delete process.env[revenueCatAuthEnvKey];
    } else {
      process.env[revenueCatAuthEnvKey] = previousRevenueCatSecret;
    }
    if (previousStripeSecret === undefined) {
      delete process.env[stripeSecretEnvKey];
    } else {
      process.env[stripeSecretEnvKey] = previousStripeSecret;
    }
  }
});

test("RevenueCat authentication still precedes body parsing", async () => {
  const previous = process.env[revenueCatAuthEnvKey];
  process.env[revenueCatAuthEnvKey] = revenueCatSecret;
  try {
    const route = createRevenueCatWebhookRoute({} as ApiServiceRuntime);
    const unauthorized = await route.request(
      receiveRevenueCatWebhookOperation.path,
      { body: "{", method: "POST" },
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Unauthorized" });

    const malformed = await route.request(
      receiveRevenueCatWebhookOperation.path,
      {
        body: "{",
        headers: {
          [billingWebhookWireHeaderNames.revenueCatAuthorization]:
            revenueCatSecret,
        },
        method: "POST",
      },
    );
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "Invalid JSON body" });

    const invalid = await route.request(
      receiveRevenueCatWebhookOperation.path,
      {
        body: "{}",
        headers: {
          [billingWebhookWireHeaderNames.revenueCatAuthorization]:
            revenueCatSecret,
        },
        method: "POST",
      },
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Invalid webhook payload",
    });
  } finally {
    if (previous === undefined) {
      delete process.env[revenueCatAuthEnvKey];
    } else {
      process.env[revenueCatAuthEnvKey] = previous;
    }
  }
});

test("Stripe authenticates the raw body before boundary JSON parsing", async () => {
  const previous = process.env[stripeSecretEnvKey];
  process.env[stripeSecretEnvKey] = stripeSecret;
  try {
    const route = createStripeWebhookRoute({} as ApiServiceRuntime);
    const unauthorized = await route.request(
      receiveStripeWebhookOperation.path,
      {
        body: "{",
        method: "POST",
      },
    );
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "Invalid signature" });

    for (const payload of ["{", "[]", "{}"]) {
      const response = await route.request(receiveStripeWebhookOperation.path, {
        body: payload,
        headers: {
          [billingWebhookWireHeaderNames.stripeSignature]:
            stripeSignature(payload),
        },
        method: "POST",
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        outcome: "ignored",
        received: true,
      });
    }
  } finally {
    if (previous === undefined) {
      delete process.env[stripeSecretEnvKey];
    } else {
      process.env[stripeSecretEnvKey] = previous;
    }
  }
});
