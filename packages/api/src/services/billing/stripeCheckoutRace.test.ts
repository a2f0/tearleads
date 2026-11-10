import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import {
  createStripeCheckout,
  createStripeCheckoutSession,
} from "./stripeCheckout";

function checkoutFetch(recordedCreates: Request[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/prices/price_sync")) {
      return Response.json({
        active: true,
        currency: "usd",
        id: "price_sync",
        product: { active: true, id: "prod_sync" },
        recurring: { interval: "month", interval_count: 1 },
        unit_amount: 500,
      });
    }
    if (path.endsWith("/subscriptions/search")) {
      return Response.json({ data: [], has_more: false });
    }
    if (path.endsWith("/customers/search")) {
      return Response.json({ data: [{ id: "cus_org" }] });
    }
    if (path.endsWith("/subscriptions") && request.method !== "POST") {
      return Response.json({ data: [], has_more: false });
    }
    if (path.endsWith("/subscriptions")) {
      recordedCreates.push(request);
      return Response.json({
        id: "sub_org",
        latest_invoice: {
          payment_intent: { client_secret: "pi_secret" },
        },
      });
    }
    if (path.endsWith("/checkout/sessions")) {
      recordedCreates.push(request);
      return Response.json({ url: "https://checkout.stripe.com/pay/cs_org" });
    }
    throw new Error(`Unexpected Stripe request: ${path}`);
  }) as typeof fetch;
}

function deps(fetchImpl: typeof fetch) {
  return {
    revenueCat: { env: REVENUECAT_ENV },
    stripe: { env: STRIPE_ENV, fetchImpl },
  };
}

test("concurrent inline and hosted services issue one provider create", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const creates: Request[] = [];
  const serviceDeps = deps(checkoutFetch(creates));
  const results = await Promise.allSettled([
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_sync",
      serviceDeps,
    ),
    createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { priceId: "price_sync", returnUrl: "https://app.example/billing" },
      serviceDeps,
    ),
  ]);

  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toMatchObject({ status: 409 });
  expect(creates).toHaveLength(1);
});

test("a Pay for a plan that is no longer offered reserves nothing", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const creates: Request[] = [];
  const serviceDeps = deps(checkoutFetch(creates));

  // A form loaded before a Price was retired must not hold the organization's
  // one checkout reservation once it is refused.
  await expect(
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_retired",
      serviceDeps,
    ),
  ).rejects.toMatchObject({
    code: "billing_checkout_plan_unavailable",
    status: 409,
  });
  const [billing] = await db
    .select({ attemptId: organizationBilling.checkoutAttemptId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.attemptId).toBeNull();

  // Another mode is not locked out by the refused Pay.
  expect(
    await createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      { priceId: "price_sync", returnUrl: "https://app.example/billing" },
      serviceDeps,
    ),
  ).toBe("https://checkout.stripe.com/pay/cs_org");
  expect(creates).toHaveLength(1);
});

test("a Pay for a Price Stripe no longer offers reserves nothing", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const creates: Request[] = [];
  const offered = checkoutFetch(creates);
  // Team 5 is still configured here, but its Price was archived in Stripe.
  const archivedTeam = (async (input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input)).pathname.endsWith("/prices/price_team_5")
      ? Response.json({
          active: false,
          currency: "usd",
          id: "price_team_5",
          product: { active: true, id: "prod_team_5" },
          recurring: { interval: "month", interval_count: 1 },
          unit_amount: 1_000,
        })
      : offered(input, init)) as typeof fetch;

  await expect(
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_team_5",
      deps(archivedTeam),
    ),
  ).rejects.toMatchObject({
    code: "billing_checkout_plan_unavailable",
    status: 409,
  });
  const [billing] = await db
    .select({ attemptId: organizationBilling.checkoutAttemptId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.attemptId).toBeNull();
  expect(creates).toHaveLength(0);
});

test("hosted retries reuse a provider key and expired attempts rotate it", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const creates: Request[] = [];
  const serviceDeps = deps(checkoutFetch(creates));
  const create = () =>
    createStripeCheckoutSession(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      {
        priceId: "price_sync",
        returnUrl: "https://app.example/billing?transient=1",
      },
      serviceDeps,
    );

  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_org");
  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_org");
  expect(creates).toHaveLength(2);
  expect(creates[0]?.headers.get("Idempotency-Key")).toBe(
    creates[1]?.headers.get("Idempotency-Key"),
  );
  const firstBody = new URLSearchParams(await creates[0]?.text());
  const secondBody = new URLSearchParams(await creates[1]?.text());
  expect(firstBody.get("expires_at")).toBe(secondBody.get("expires_at"));
  expect(firstBody.get("subscription_data[metadata][checkoutAttemptId]")).toBe(
    creates[0]?.headers.get("Idempotency-Key")?.split(":").at(-1) ?? null,
  );

  await db
    .update(organizationBilling)
    .set({ checkoutAttemptExpiresAt: new Date(0) })
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_org");
  expect(creates).toHaveLength(3);
  expect(creates[2]?.headers.get("Idempotency-Key")).not.toBe(
    creates[0]?.headers.get("Idempotency-Key"),
  );
});

test("incomplete provider configuration does not reserve an attempt", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  expect(
    await createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      "price_sync",
      { stripe: { env: {} }, revenueCat: { env: {} } },
    ),
  ).toBeNull();

  const [billing] = await db
    .select({ attemptId: organizationBilling.checkoutAttemptId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(billing?.attemptId).toBeNull();
});
