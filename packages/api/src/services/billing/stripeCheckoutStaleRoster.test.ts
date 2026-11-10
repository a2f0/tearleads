import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/test-utils";
import {
  registerAndAuthenticateWithOrganization,
  registerUser,
} from "../../../test/helpers/registerUser";
import { addEffectiveOrganizationMember } from "../../../test/helpers/revenuecatWebhook";
import { activeStripePrice } from "../../../test/helpers/stripeCatalog";
import {
  REVENUECAT_WEBHOOK_ENV as REVENUECAT_ENV,
  STRIPE_WEBHOOK_ENV as STRIPE_ENV,
} from "../../../test/helpers/stripeWebhook";
import { getDefaultApiServiceRuntime } from "../runtime";
import { createStripeCheckout } from "./stripeCheckout";

/** The fixed tiers' monthly prices, keyed by the test env's Price ids. */
const PRICE_CENTS: Readonly<Record<string, number>> = {
  price_sync: 500,
  price_team_5: 1_000,
};

interface FakeSubscription {
  readonly id: string;
  status: string;
  readonly metadata: {
    readonly checkoutAttemptId: string | null;
    readonly userId: string | null;
  };
  readonly items: { data: [{ price: { id: string }; quantity: 1 }] };
  readonly latest_invoice: string;
}

interface FakeStripe {
  readonly creates: URLSearchParams[];
  readonly fetchImpl: typeof fetch;
  readonly idempotencyKeys: (string | null)[];
  readonly voids: string[];
}

/**
 * A Stripe account holding the buyer's subscriptions: creates record their
 * attempt and Price, voiding a first invoice expires its subscription, and
 * `refuseVoids` answers voids as Stripe does once the payment succeeded.
 */
function fakeStripe(
  options: { readonly refuseVoids?: boolean } = {},
): FakeStripe {
  const subscriptions: FakeSubscription[] = [];
  const creates: URLSearchParams[] = [];
  const idempotencyKeys: (string | null)[] = [];
  const voids: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const price = /^\/v1\/prices\/(price_\w+)$/.exec(path)?.[1];
    if (price) {
      return Response.json(activeStripePrice(price, PRICE_CENTS[price] ?? 0));
    }
    if (path === "/v1/customers/search") {
      return Response.json({ data: [{ id: "cus_org" }] });
    }
    if (path === "/v1/subscriptions/search") {
      return Response.json({ data: subscriptions, has_more: false });
    }
    if (path === "/v1/subscriptions" && request.method === "GET") {
      return Response.json({ data: subscriptions, has_more: false });
    }
    if (path === "/v1/subscriptions") {
      const form = new URLSearchParams(await request.text());
      creates.push(form);
      idempotencyKeys.push(request.headers.get("Idempotency-Key"));
      const n = subscriptions.length + 1;
      const subscription: FakeSubscription = {
        id: `sub_${n}`,
        status: "incomplete",
        metadata: {
          checkoutAttemptId: form.get("metadata[checkoutAttemptId]"),
          userId: form.get("metadata[userId]"),
        },
        items: {
          data: [
            { price: { id: form.get("items[0][price]") ?? "" }, quantity: 1 },
          ],
        },
        latest_invoice: `in_${n}`,
      };
      subscriptions.push(subscription);
      return Response.json(expanded(subscription));
    }
    const invoice = /^\/v1\/invoices\/(in_\d+)\/void$/.exec(path)?.[1];
    if (invoice) {
      voids.push(invoice);
      if (options.refuseVoids) {
        return Response.json({ error: {} }, { status: 400 });
      }
      const voided = subscriptions.find((s) => s.latest_invoice === invoice);
      if (voided) voided.status = "incomplete_expired";
      return Response.json({ id: invoice, status: "void" });
    }
    const subscription = subscriptions.find(
      (s) => path === `/v1/subscriptions/${s.id}`,
    );
    if (subscription) return Response.json(expanded(subscription));
    throw new Error(`Unexpected Stripe request: ${request.method} ${path}`);
  }) as typeof fetch;
  return { creates, fetchImpl, idempotencyKeys, voids };
}

/** The subscription with its first invoice's PaymentIntent expanded. */
function expanded(subscription: FakeSubscription) {
  const n = subscription.id.slice("sub_".length);
  return {
    ...subscription,
    latest_invoice: {
      id: subscription.latest_invoice,
      payment_intent: { client_secret: `pi_${n}` },
    },
  };
}

async function startedCheckoutThenRosterChange(stripe: FakeStripe) {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const deps = {
    revenueCat: { env: REVENUECAT_ENV },
    stripe: { env: STRIPE_ENV, fetchImpl: stripe.fetchImpl },
  };
  const checkout = () =>
    createStripeCheckout(
      getDefaultApiServiceRuntime(),
      organizationId,
      admin.userId,
      deps,
    );
  expect(await checkout()).toEqual({
    subscriptionId: "sub_1",
    clientSecret: "pi_1",
  });
  const member = createTestUser();
  await registerUser(member);
  await addEffectiveOrganizationMember({
    actor: admin,
    organizationId,
    userId: member.userId,
  });
  return checkout;
}

test("the buyer's unpaid checkout for an old roster is replaced at the new tier", async () => {
  const stripe = fakeStripe();
  const checkout = await startedCheckoutThenRosterChange(stripe);

  expect(await checkout()).toEqual({
    subscriptionId: "sub_2",
    clientSecret: "pi_2",
  });
  expect(stripe.voids).toEqual(["in_1"]);
  expect(stripe.creates.map((form) => form.get("items[0][price]"))).toEqual([
    "price_sync",
    "price_team_5",
  ]);
  const [first, second] = stripe.idempotencyKeys;
  expect(second).not.toBe(first);
  // The replacement is now the reserved attempt: a retry resumes it.
  expect(await checkout()).toEqual({
    subscriptionId: "sub_2",
    clientSecret: "pi_2",
  });
  expect(stripe.creates).toHaveLength(2);
});

test("a stale checkout whose payment won keeps the conflict", async () => {
  const stripe = fakeStripe({ refuseVoids: true });
  const checkout = await startedCheckoutThenRosterChange(stripe);

  await expect(checkout()).rejects.toMatchObject({ status: 409 });
  expect(stripe.voids).toEqual(["in_1"]);
  expect(stripe.creates).toHaveLength(1);
});
