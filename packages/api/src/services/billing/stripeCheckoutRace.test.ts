import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { organizationBilling } from "@tearleads/api-shared/schema";
import { createTestUser } from "@tearleads/test-utils";
import { eq } from "drizzle-orm";
import { registerAndAuthenticateWithOrganization } from "../../../test/helpers/registerUser";
import { fakeStripeCheckout } from "../../../test/helpers/stripeCheckoutFake";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { createStripeCheckout } from "./stripeCheckout";
import { createStripeCheckoutSession } from "./stripeHostedCheckout";

function deps(fetchImpl: typeof fetch) {
  return {
    revenueCat: { env: REVENUECAT_ENV },
    stripe: { env: STRIPE_ENV, fetchImpl },
  };
}

async function buyerWithStripe() {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const stripe = fakeStripeCheckout(organizationId, admin.userId);
  const serviceDeps = deps(stripe.fetchImpl);
  return {
    organizationId,
    stripe,
    payInline: (priceId = "price_sync", serviceDepsOverride = serviceDeps) =>
      createStripeCheckout(
        getDefaultApiServiceRuntime(),
        organizationId,
        admin.userId,
        priceId,
        serviceDepsOverride,
      ),
    payOnStripe: (
      priceId = "price_sync",
      serviceDepsOverride = serviceDeps,
      returnUrl = "https://app.example/billing",
    ) =>
      createStripeCheckoutSession(
        getDefaultApiServiceRuntime(),
        organizationId,
        admin.userId,
        { priceId, returnUrl },
        serviceDepsOverride,
      ),
  };
}

async function reservedAttemptId(organizationId: string) {
  const [billing] = await db
    .select({ attemptId: organizationBilling.checkoutAttemptId })
    .from(organizationBilling)
    .where(eq(organizationBilling.organizationId, organizationId));
  return billing?.attemptId ?? null;
}

test("concurrent inline and hosted checkouts leave one payable checkout", async () => {
  const { organizationId, payInline, payOnStripe, stripe } =
    await buyerWithStripe();
  const results = await Promise.allSettled([payInline(), payOnStripe()]);

  // Whichever reserved last wins; the other is refused or retired, so the
  // buyer can never pay twice.
  const rejected = results.filter((result) => result.status === "rejected");
  expect(rejected).toHaveLength(1);
  expect(rejected[0]?.reason).toMatchObject({ status: 409 });
  expect(stripe.payable()).toHaveLength(1);
  expect(stripe.payable()[0]?.attemptId).toBe(
    (await reservedAttemptId(organizationId)) ?? "",
  );
});

test("leaving Stripe's page does not hold the buyer's inline Pay", async () => {
  const { payInline, payOnStripe, stripe } = await buyerWithStripe();
  // The buyer opens Stripe's page, then cancels or closes it without paying.
  expect(await payOnStripe()).toBe("https://checkout.stripe.com/pay/cs_1");

  const intent = await payInline();

  expect(intent?.subscriptionId).toBe("sub_1");
  // The abandoned page can no longer be paid; only the form can.
  expect(stripe.sessions.map(({ status }) => status)).toEqual(["expired"]);
  expect(stripe.payable().map(({ id }) => id)).toEqual(["sub_1"]);
});

test("Stripe's page for the open form's plan retires the form's checkout", async () => {
  const { payInline, payOnStripe, stripe } = await buyerWithStripe();
  await payInline("price_team_5");

  expect(await payOnStripe("price_team_5")).toBe(
    "https://checkout.stripe.com/pay/cs_1",
  );
  expect(stripe.subscriptions.map(({ status }) => status)).toEqual([
    "incomplete_expired",
  ]);
  expect(stripe.payable().map(({ id }) => id)).toEqual(["cs_1"]);
});

test("a completed Stripe page keeps the buyer's other checkouts refused", async () => {
  const { payInline, payOnStripe, stripe } = await buyerWithStripe();
  await payOnStripe();
  // Paid on Stripe's page; its subscription may still be settling.
  const [session] = stripe.sessions;
  if (session) session.status = "complete";

  await expect(payInline()).rejects.toMatchObject({
    message: "A checkout is already in progress for this organization",
    status: 409,
  });
  expect(stripe.subscriptions).toHaveLength(0);
});

test("a Stripe page minted after its attempt was replaced is expired", async () => {
  const { organizationId, payInline, payOnStripe, stripe } =
    await buyerWithStripe();
  let inline: Promise<unknown> | undefined;
  // The buyer cancels the page while it is being created and pays inline:
  // the inline checkout replaces the attempt before the Session exists.
  const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/v1/checkout/sessions" &&
      !inline
    ) {
      inline = payInline();
      await inline;
    }
    return stripe.fetchImpl(request);
  }) as typeof fetch;

  await expect(payOnStripe("price_sync", deps(racing))).rejects.toMatchObject({
    status: 409,
  });
  expect(stripe.sessions.map(({ status }) => status)).toEqual(["expired"]);
  expect(stripe.payable().map(({ attemptId }) => attemptId)).toEqual([
    (await reservedAttemptId(organizationId)) ?? "",
  ]);
});

test("a Pay for a plan that is no longer offered reserves nothing", async () => {
  const { organizationId, payInline, payOnStripe, stripe } =
    await buyerWithStripe();

  // A form loaded before a Price was retired must not hold the organization's
  // one checkout reservation once it is refused.
  await expect(payInline("price_retired")).rejects.toMatchObject({
    code: "billing_checkout_plan_unavailable",
    status: 409,
  });
  expect(await reservedAttemptId(organizationId)).toBeNull();

  // Another mode is not locked out by the refused Pay.
  expect(await payOnStripe()).toBe("https://checkout.stripe.com/pay/cs_1");
  expect(stripe.creates).toHaveLength(1);
});

test("a Pay for a Price Stripe no longer offers reserves nothing", async () => {
  const { organizationId, payInline, stripe } = await buyerWithStripe();
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
      : stripe.fetchImpl(input, init)) as typeof fetch;

  await expect(
    payInline("price_team_5", deps(archivedTeam)),
  ).rejects.toMatchObject({
    code: "billing_checkout_plan_unavailable",
    status: 409,
  });
  expect(await reservedAttemptId(organizationId)).toBeNull();
  expect(stripe.creates).toHaveLength(0);
});

test("hosted retries reuse a provider key and expired attempts rotate it", async () => {
  const { organizationId, payOnStripe, stripe } = await buyerWithStripe();
  const create = () =>
    payOnStripe(
      "price_sync",
      undefined,
      "https://app.example/billing?transient=1",
    );

  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_1");
  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_1");
  const [first, second] = stripe.creates;
  expect(first?.idempotencyKey).toBe(second?.idempotencyKey ?? "");
  expect(first?.form.get("expires_at")).toBe(
    second?.form.get("expires_at") ?? null,
  );
  expect(
    first?.form.get("subscription_data[metadata][checkoutAttemptId]"),
  ).toBe(first?.idempotencyKey.split(":").at(-1) ?? null);

  await db
    .update(organizationBilling)
    .set({ checkoutAttemptExpiresAt: new Date(0) })
    .where(eq(organizationBilling.organizationId, organizationId));
  expect(await create()).toBe("https://checkout.stripe.com/pay/cs_2");
  expect(stripe.creates[2]?.idempotencyKey).not.toBe(first?.idempotencyKey);
  // The lapsed attempt's page is retired before the new one is offered.
  expect(stripe.sessions.map(({ status }) => status)).toEqual([
    "expired",
    "open",
  ]);
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
  expect(await reservedAttemptId(organizationId)).toBeNull();
});
