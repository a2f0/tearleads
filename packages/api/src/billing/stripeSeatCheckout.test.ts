import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch as fakeFetch,
  STRIPE_PAYLOAD_PRICE as TEAM_5_PRICE,
} from "../../test/helpers/stripePayloadFetch";
import { createSyncSubscription } from "./stripeApi";
import { createCheckoutSession } from "./stripeCheckoutSession";

test("direct subscription creation selects a fixed tier at quantity one", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: TEAM_5_PRICE },
    { body: { data: [], has_more: false } },
    {
      body: {
        id: "sub_1",
        latest_invoice: { payment_intent: { client_secret: "pi_secret" } },
      },
    },
  ]);

  await createSyncSubscription(
    {
      checkoutAttemptId: "attempt-inline-1",
      customerId: "cus_1",
      userId: "user-1",
      organizationId: "org-1",
      seatQuantity: 3,
    },
    { env: ENV, fetchImpl },
  );

  const body = requests[2]?.body;
  expect(body).toContain(`${encodeURIComponent("items[0][quantity]")}=1`);
  expect(body).toContain(`${encodeURIComponent("items[0][price]")}=price_sync`);
});

test("hosted Checkout selects a fixed tier at quantity one", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: TEAM_5_PRICE },
    { body: { url: "https://checkout.stripe.com/pay/cs_1" } },
  ]);

  await createCheckoutSession(
    {
      checkoutAttemptId: "attempt-hosted-1",
      customerId: "cus_1",
      expiresAt: new Date("2030-01-01T00:45:00.000Z"),
      userId: "user-1",
      organizationId: "org-1",
      returnUrl: "https://app.example/billing",
      seatQuantity: 4,
    },
    { env: ENV, fetchImpl },
  );

  expect(requests[1]?.body).toContain(
    `${encodeURIComponent("line_items[0][quantity]")}=1`,
  );
});

test("does not resume an incomplete checkout with a stale quantity", async () => {
  const { fetchImpl, requests } = fakeFetch([
    { body: TEAM_5_PRICE },
    {
      body: {
        data: [{ id: "sub_pending", status: "incomplete" }],
        has_more: false,
      },
    },
    {
      body: {
        id: "sub_pending",
        status: "incomplete",
        metadata: { userId: "user-1" },
        items: { data: [{ price: { id: "price_sync" }, quantity: 1 }] },
        latest_invoice: { payment_intent: { client_secret: "pi_secret" } },
      },
    },
  ]);

  expect(
    await createSyncSubscription(
      {
        checkoutAttemptId: "attempt-inline-2",
        customerId: "cus_1",
        userId: "user-1",
        organizationId: "org-1",
        seatQuantity: 2,
      },
      { env: ENV, fetchImpl },
    ),
  ).toEqual({ kind: "conflict" });
  expect(requests).toHaveLength(3);
});

test("checkout APIs reject non-positive seat quantities", async () => {
  await expect(
    createSyncSubscription(
      {
        checkoutAttemptId: "attempt-inline-3",
        customerId: "cus_1",
        userId: "user-1",
        organizationId: "org-1",
        seatQuantity: 0,
      },
      { env: ENV },
    ),
  ).rejects.toBeInstanceOf(RangeError);
  await expect(
    createCheckoutSession(
      {
        checkoutAttemptId: "attempt-hosted-2",
        customerId: "cus_1",
        expiresAt: new Date("2030-01-01T00:45:00.000Z"),
        userId: "user-1",
        organizationId: "org-1",
        returnUrl: "https://app.example/billing",
        seatQuantity: 1.5,
      },
      { env: ENV },
    ),
  ).rejects.toBeInstanceOf(RangeError);
});
