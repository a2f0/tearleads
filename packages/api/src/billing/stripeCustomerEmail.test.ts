import { expect, mock, test } from "bun:test";
import { ensureStripeCustomerEmail } from "./stripeCustomerEmail";
import type { StripeSubscriptionBinding } from "./stripeSubscriptionBinding";

function binding(
  overrides: Partial<StripeSubscriptionBinding>,
): StripeSubscriptionBinding {
  return {
    billingPeriodEndsAt: null,
    billingPeriodStartsAt: null,
    currency: null,
    customerEmail: null,
    customerId: "cus_1",
    interval: null,
    intervalCount: null,
    organizationId: null,
    paymentMethodBillingEmail: null,
    priceId: null,
    seatQuantity: null,
    status: null,
    subscriptionItemId: null,
    unitAmount: null,
    userId: null,
    ...overrides,
  };
}

test("an existing Stripe Customer email needs no update", async () => {
  const fetchImpl = mock(() => Promise.resolve(new Response("{}")));

  expect(
    await ensureStripeCustomerEmail(binding({ customerEmail: "a@b.test" }), {
      env: { STRIPE_SECRET_KEY: "sk_test_123" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  ).toBe(true);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("the payment-method email is promoted to the Stripe Customer", async () => {
  const requests: Array<{ body: string | null; url: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ body: init?.body?.toString() ?? null, url: String(input) });
    return new Response("{}");
  }) as typeof fetch;

  expect(
    await ensureStripeCustomerEmail(
      binding({ paymentMethodBillingEmail: "buyer@example.com" }),
      { env: { STRIPE_SECRET_KEY: "sk_test_123" }, fetchImpl },
    ),
  ).toBe(true);
  expect(requests).toEqual([
    {
      body: "email=buyer%40example.com",
      url: "https://api.stripe.com/v1/customers/cus_1",
    },
  ]);
});

test("a subscription without any email cannot be acknowledged", async () => {
  expect(
    await ensureStripeCustomerEmail(binding({}), {
      env: { STRIPE_SECRET_KEY: "sk_test_123" },
    }),
  ).toBe(false);
});
