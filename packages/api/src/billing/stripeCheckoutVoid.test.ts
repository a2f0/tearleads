import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch,
} from "../../test/helpers/stripePayloadFetch";
import { voidStaleInlineCheckout } from "./stripeCheckoutVoid";

const STALE = {
  id: "sub_stale",
  status: "incomplete",
  metadata: { checkoutAttemptId: "attempt-old", orgId: "org-1" },
  latest_invoice: "in_stale",
};
const EXPIRED = {
  id: "sub_expired",
  status: "incomplete_expired",
  metadata: { checkoutAttemptId: "attempt-older" },
  latest_invoice: "in_expired",
};

function voidWith(
  subscriptions: unknown[],
  extra: Array<{ status?: number; body: unknown }> = [],
  hasMore = false,
) {
  const { fetchImpl, requests } = recordingStripeFetch([
    { body: { data: subscriptions, has_more: hasMore } },
    ...extra,
  ]);
  const voided = voidStaleInlineCheckout(
    { customerId: "cus_1", checkoutAttemptId: "attempt-old" },
    { env: ENV, fetchImpl },
  );
  return { requests, voided };
}

test("voids the stale attempt's first invoice, skipping terminal ones", async () => {
  const { requests, voided } = voidWith(
    [EXPIRED, STALE],
    [{ body: { id: "in_stale", status: "void" } }],
  );

  expect(await voided).toBe(true);
  const list = new URL(requests[0]?.url ?? "");
  expect(list.pathname).toBe("/v1/subscriptions");
  expect(list.searchParams.get("customer")).toBe("cus_1");
  expect(list.searchParams.get("status")).toBe("all");
  expect(requests.slice(1).map(({ method, url }) => [method, url])).toEqual([
    ["POST", "https://api.stripe.com/v1/invoices/in_stale/void"],
  ]);
});

test("nothing payable left for the attempt needs no void", async () => {
  const { requests, voided } = voidWith([EXPIRED]);

  expect(await voided).toBe(true);
  expect(requests).toHaveLength(1);
});

test.each<[string, unknown[], boolean]>([
  ["a live subscription", [{ ...STALE, status: "active" }], false],
  [
    "another attempt's incomplete checkout",
    [{ ...STALE, metadata: { checkoutAttemptId: "attempt-other" } }],
    false,
  ],
  ["an unreadable invoice", [{ ...STALE, latest_invoice: null }], false],
  ["a second page of subscriptions", [STALE], true],
])("%s voids nothing and refuses", async (_, subscriptions, hasMore) => {
  const { requests, voided } = voidWith(subscriptions, [], hasMore);

  expect(await voided).toBe(false);
  expect(requests).toHaveLength(1);
});

test("a void Stripe refuses because the payment won is a refusal", async () => {
  const { voided } = voidWith(
    [STALE],
    [{ status: 400, body: { error: { message: "already paid" } } }],
  );

  expect(await voided).toBe(false);
});

test("a provider failure during the void is not mistaken for a refusal", async () => {
  const { voided } = voidWith([STALE], [{ status: 500, body: {} }]);

  await expect(voided).rejects.toMatchObject({
    name: "StripeApiError",
    status: 500,
  });
});
