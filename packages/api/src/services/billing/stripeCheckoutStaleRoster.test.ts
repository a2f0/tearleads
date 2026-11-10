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

interface FakeStripeOptions {
  /** Answer voids as Stripe does once the payment succeeded. */
  readonly refuseVoids?: boolean;
  /** Fail the first void as a provider outage would. */
  readonly failFirstVoid?: boolean;
  /** Hold the first subscription create until `release` settles. */
  readonly holdFirstCreate?: {
    readonly reached: () => void;
    readonly release: Promise<void>;
  };
}

interface FakeStripe {
  readonly fetchImpl: typeof fetch;
  readonly subscriptions: FakeSubscription[];
  readonly voids: string[];
}

/**
 * A Stripe account holding the buyer's subscriptions. Creates honor their
 * idempotency key and record attempt and Price; voiding a first invoice
 * expires its subscription, and voiding it again is refused.
 */
function fakeStripe(options: FakeStripeOptions = {}): FakeStripe {
  const subscriptions: FakeSubscription[] = [];
  const byIdempotencyKey = new Map<string, FakeSubscription>();
  const voids: string[] = [];
  let createCalls = 0;
  const createSubscription = async (request: Request) => {
    createCalls += 1;
    if (createCalls === 1 && options.holdFirstCreate) {
      options.holdFirstCreate.reached();
      await options.holdFirstCreate.release;
    }
    const key = request.headers.get("Idempotency-Key") ?? "";
    const replayed = byIdempotencyKey.get(key);
    if (replayed) return Response.json(expanded(replayed));
    const form = new URLSearchParams(await request.text());
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
    byIdempotencyKey.set(key, subscription);
    return Response.json(expanded(subscription));
  };
  const invoiceResponse = (invoice: string, isVoid: boolean) => {
    const owner = subscriptions.find((s) => s.latest_invoice === invoice);
    const voided = owner?.status === "incomplete_expired";
    if (!isVoid) {
      const status = options.refuseVoids ? "paid" : voided ? "void" : "open";
      return Response.json({ id: invoice, status });
    }
    voids.push(invoice);
    if (options.failFirstVoid && voids.length === 1) {
      return Response.json({ error: {} }, { status: 500 });
    }
    if (options.refuseVoids || voided || !owner) {
      return Response.json({ error: {} }, { status: 400 });
    }
    owner.status = "incomplete_expired";
    return Response.json({ id: invoice, status: "void" });
  };
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
    if (path === "/v1/subscriptions/search" || path === "/v1/subscriptions") {
      return request.method === "POST"
        ? createSubscription(request)
        : Response.json({ data: subscriptions, has_more: false });
    }
    const invoice = /^\/v1\/invoices\/(in_\d+)(\/void)?$/.exec(path);
    if (invoice?.[1]) {
      return invoiceResponse(invoice[1], invoice[2] !== undefined);
    }
    const subscription = subscriptions.find(
      (s) => path === `/v1/subscriptions/${s.id}`,
    );
    if (subscription) return Response.json(expanded(subscription));
    throw new Error(`Unexpected Stripe request: ${request.method} ${path}`);
  }) as typeof fetch;
  return { fetchImpl, subscriptions, voids };
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

/** A one-member organization whose admin buys through `stripe`. */
async function organizationBuyingThrough(stripe: FakeStripe) {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticateWithOrganization(admin);
  const deps = {
    revenueCat: { env: REVENUECAT_ENV },
    stripe: { env: STRIPE_ENV, fetchImpl: stripe.fetchImpl },
  };
  return {
    checkout: () =>
      createStripeCheckout(
        getDefaultApiServiceRuntime(),
        organizationId,
        admin.userId,
        deps,
      ),
    addMember: async () => {
      const member = createTestUser();
      await registerUser(member);
      await addEffectiveOrganizationMember({
        actor: admin,
        organizationId,
        userId: member.userId,
      });
    },
  };
}

const SECOND_CHECKOUT = { subscriptionId: "sub_2", clientSecret: "pi_2" };

function statuses(stripe: FakeStripe): string[][] {
  return stripe.subscriptions.map(({ id, status }) => [id, status]);
}

test("the buyer's unpaid checkout for an old roster is replaced at the new tier", async () => {
  const stripe = fakeStripe();
  const { addMember, checkout } = await organizationBuyingThrough(stripe);
  await checkout();
  await addMember();

  expect(await checkout()).toEqual(SECOND_CHECKOUT);
  expect(stripe.voids).toEqual(["in_1"]);
  expect(stripe.subscriptions.map((s) => s.items.data[0].price.id)).toEqual([
    "price_sync",
    "price_team_5",
  ]);
  // The replacement is now the reserved attempt: a retry resumes it.
  expect(await checkout()).toEqual(SECOND_CHECKOUT);
  expect(statuses(stripe)).toEqual([
    ["sub_1", "incomplete_expired"],
    ["sub_2", "incomplete"],
  ]);
});

test("concurrent retries after a roster change share one replacement", async () => {
  const stripe = fakeStripe();
  const { addMember, checkout } = await organizationBuyingThrough(stripe);
  await checkout();
  await addMember();

  expect(await Promise.all([checkout(), checkout()])).toEqual([
    SECOND_CHECKOUT,
    SECOND_CHECKOUT,
  ]);
  expect(statuses(stripe)).toEqual([
    ["sub_1", "incomplete_expired"],
    ["sub_2", "incomplete"],
  ]);
});

test("a retry after a failed void still voids the old checkout", async () => {
  const stripe = fakeStripe({ failFirstVoid: true });
  const { addMember, checkout } = await organizationBuyingThrough(stripe);
  await checkout();
  await addMember();

  await expect(checkout()).rejects.toMatchObject({ status: 500 });
  expect(statuses(stripe)).toEqual([["sub_1", "incomplete"]]);
  expect(await checkout()).toEqual(SECOND_CHECKOUT);
  expect(statuses(stripe)).toEqual([
    ["sub_1", "incomplete_expired"],
    ["sub_2", "incomplete"],
  ]);
});

test("a stale checkout whose payment won keeps the conflict", async () => {
  const stripe = fakeStripe({ refuseVoids: true });
  const { addMember, checkout } = await organizationBuyingThrough(stripe);
  await checkout();
  await addMember();

  await expect(checkout()).rejects.toMatchObject({ status: 409 });
  expect(stripe.voids).toEqual(["in_1"]);
  expect(stripe.subscriptions).toHaveLength(1);
});

test("a create that lands after its attempt was replaced voids itself", async () => {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const stripe = fakeStripe({
    holdFirstCreate: { reached: reached.resolve, release: release.promise },
  });
  const { addMember, checkout } = await organizationBuyingThrough(stripe);
  const stale = checkout();
  await reached.promise;
  await addMember();

  // The replacement finds nothing to void yet: the stale create is in flight.
  expect(await checkout()).toEqual({
    subscriptionId: "sub_1",
    clientSecret: "pi_1",
  });
  release.resolve();

  await expect(stale).rejects.toMatchObject({ status: 409 });
  expect(stripe.voids).toEqual(["in_2"]);
  expect(statuses(stripe)).toEqual([
    ["sub_1", "incomplete"],
    ["sub_2", "incomplete_expired"],
  ]);
});
