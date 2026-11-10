import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch,
} from "../../test/helpers/stripePayloadFetch";
import { voidStaleInlineCheckouts } from "./stripeCheckoutVoid";

const STALE = {
  id: "sub_stale",
  status: "incomplete",
  metadata: { checkoutAttemptId: "attempt-old", orgId: "org-1" },
  latest_invoice: "in_stale",
};
const CURRENT = {
  id: "sub_current",
  status: "incomplete",
  metadata: { checkoutAttemptId: "attempt-current", orgId: "org-1" },
  latest_invoice: "in_current",
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
  stillReserved = true,
) {
  const { fetchImpl, requests } = recordingStripeFetch([
    { body: { data: subscriptions, has_more: false } },
    ...extra,
  ]);
  const voided = voidStaleInlineCheckouts(
    {
      customerId: "cus_1",
      currentAttemptId: "attempt-current",
      stillReserved: async () => stillReserved,
    },
    { env: ENV, fetchImpl },
  );
  return { requests, voided };
}

test("voids other attempts' unpaid checkouts and keeps the current one", async () => {
  const { requests, voided } = voidWith(
    [EXPIRED, CURRENT, STALE],
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

test("nothing stale needs no void", async () => {
  const { requests, voided } = voidWith([EXPIRED, CURRENT]);

  expect(await voided).toBe(true);
  expect(requests).toHaveLength(1);
});

test.each<[string, unknown[], boolean]>([
  ["a live subscription", [STALE, { ...CURRENT, status: "active" }], true],
  ["an unreadable invoice", [{ ...STALE, latest_invoice: null }], true],
  ["an attempt replaced since it was acquired", [STALE], false],
])("%s voids nothing and refuses", async (_, subscriptions, reserved) => {
  const { requests, voided } = voidWith(subscriptions, [], reserved);

  expect(await voided).toBe(false);
  expect(requests).toHaveLength(1);
});

test("every page of the customer's subscriptions is read", async () => {
  const { fetchImpl, requests } = recordingStripeFetch([
    { body: { data: [EXPIRED, CURRENT], has_more: true } },
    { body: { data: [STALE], has_more: false } },
    { body: { id: "in_stale", status: "void" } },
  ]);

  expect(
    await voidStaleInlineCheckouts(
      {
        customerId: "cus_1",
        currentAttemptId: "attempt-current",
        stillReserved: async () => true,
      },
      { env: ENV, fetchImpl },
    ),
  ).toBe(true);
  expect(
    new URL(requests[1]?.url ?? "").searchParams.get("starting_after"),
  ).toBe("sub_current");
  expect(requests[2]?.url).toBe(
    "https://api.stripe.com/v1/invoices/in_stale/void",
  );
});

test.each<[string, string, boolean]>([
  ["a payment that won refuses the void", "paid", false],
  ["an invoice a concurrent request voided counts as voided", "void", true],
])("%s", async (_, invoiceStatus, expected) => {
  const { requests, voided } = voidWith(
    [STALE],
    [{ status: 400, body: { error: {} } }, { body: { status: invoiceStatus } }],
  );

  expect(await voided).toBe(expected);
  expect(requests.at(-1)?.url).toBe(
    "https://api.stripe.com/v1/invoices/in_stale",
  );
});

test("a provider failure during the void is not mistaken for a refusal", async () => {
  const { voided } = voidWith([STALE], [{ status: 500, body: {} }]);

  await expect(voided).rejects.toMatchObject({
    name: "StripeApiError",
    status: 500,
  });
});
