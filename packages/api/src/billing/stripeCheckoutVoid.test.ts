import { expect, test } from "bun:test";
import {
  STRIPE_PAYLOAD_ENV as ENV,
  recordingStripeFetch,
} from "../../test/helpers/stripePayloadFetch";
import {
  expireStaleCheckoutSessions,
  voidStaleInlineCheckouts,
} from "./stripeCheckoutVoid";

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

test.each([500, 429])(
  "a %i during the void is a provider failure, not a refusal",
  async (status) => {
    const { voided } = voidWith([STALE], [{ status, body: {} }]);

    await expect(voided).rejects.toMatchObject({
      name: "StripeApiError",
      status,
    });
  },
);

const NOW = new Date("2030-01-01T01:00:00.000Z");
const nowSeconds = NOW.getTime() / 1_000;
const session = (
  id: string,
  attempt: string,
  status: string,
  ageSeconds = 60,
) => ({
  id,
  status,
  created: nowSeconds - ageSeconds,
  metadata: { checkoutAttemptId: attempt },
});

function expireWith(
  sessions: unknown[],
  extra: Array<{ status?: number; body: unknown }> = [],
  stillReserved = true,
) {
  const { fetchImpl, requests } = recordingStripeFetch([
    { body: { data: sessions, has_more: false } },
    ...extra,
  ]);
  const expired = expireStaleCheckoutSessions(
    {
      customerId: "cus_1",
      currentAttemptId: "attempt-current",
      now: NOW,
      stillReserved: async () => stillReserved,
    },
    { env: ENV, fetchImpl },
  );
  return { expired, requests };
}

test("expires other attempts' open Sessions and keeps the current one", async () => {
  const { expired, requests } = expireWith(
    [
      session("cs_current", "attempt-current", "open"),
      session("cs_old", "attempt-old", "open"),
      session("cs_lapsed", "attempt-older", "expired"),
      // Settled long ago: its subscription is what the list guard reads.
      session("cs_paid", "attempt-oldest", "complete", 86_400),
    ],
    [{ body: { id: "cs_old", status: "expired" } }],
  );

  expect(await expired).toBe(true);
  const list = new URL(requests[0]?.url ?? "");
  expect(list.pathname).toBe("/v1/checkout/sessions");
  expect(list.searchParams.get("customer")).toBe("cus_1");
  expect(requests.slice(1).map(({ method, url }) => [method, url])).toEqual([
    ["POST", "https://api.stripe.com/v1/checkout/sessions/cs_old/expire"],
  ]);
});

test.each<[string, unknown[], boolean]>([
  [
    "another attempt's Session that completed within the settling window",
    [session("cs_paid", "attempt-old", "complete", 49 * 60)],
    true,
  ],
  ["an unreadable Session", [{ id: "cs_old", status: "open" }], true],
  [
    "an attempt replaced since it was acquired",
    [session("cs_old", "attempt-old", "open")],
    false,
  ],
])("%s expires nothing and refuses", async (_, sessions, reserved) => {
  const { expired, requests } = expireWith(sessions, [], reserved);

  expect(await expired).toBe(false);
  expect(requests).toHaveLength(1);
});

test.each<[string, string, boolean]>([
  ["a Session that completed meanwhile refuses the expiry", "complete", false],
  ["a Session a concurrent request expired counts as expired", "expired", true],
])("%s", async (_, sessionStatus, expected) => {
  const { expired, requests } = expireWith(
    [session("cs_old", "attempt-old", "open")],
    [{ status: 400, body: { error: {} } }, { body: { status: sessionStatus } }],
  );

  expect(await expired).toBe(expected);
  expect(requests.at(-1)?.url).toBe(
    "https://api.stripe.com/v1/checkout/sessions/cs_old",
  );
});
