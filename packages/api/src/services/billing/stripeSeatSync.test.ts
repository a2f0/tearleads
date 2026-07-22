import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import { getDefaultApiServiceRuntime } from "../runtime";
import { runStripeSeatSynchronization } from "./stripeSeatSync";

const NOW = new Date("2026-07-15T00:00:00.000Z");
const PROVIDER_PERIOD_START = new Date(1_783_036_800 * 1000);
const PROVIDER_PERIOD_END = new Date(1_785_715_200 * 1000);
const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_SYNC_PRICE_ID: "price_sync",
};

interface StripeRequest {
  readonly body: string;
  readonly idempotencyKey: string | null;
  readonly url: string;
}

async function insertState(input: {
  readonly appliedPaidCapacity: number;
  readonly desiredPaidCapacity: number;
  readonly desiredRenewalQuantity: number;
}) {
  const organizationId = crypto.randomUUID();
  const subscriptionId = `sub_${organizationId}`;
  const subscriptionItemId = `si_${organizationId}`;
  await db.insert(organizationBilling).values({
    currentPeriodEndsAt: PROVIDER_PERIOD_END,
    currentPeriodStartsAt: PROVIDER_PERIOD_START,
    organizationId,
    seatCount: input.desiredPaidCapacity,
    seatPeriodKey: "period-1",
    status: "active",
  });
  await db.insert(organizationBillingStripeSeats).values({
    appliedPaidCapacity: input.appliedPaidCapacity,
    appliedSeatPeriodKey: "period-1",
    billingPeriodEndsAt: PROVIDER_PERIOD_END,
    billingPeriodStartsAt: PROVIDER_PERIOD_START,
    desiredPaidCapacity: input.desiredPaidCapacity,
    desiredRenewalQuantity: input.desiredRenewalQuantity,
    desiredRevision: 1,
    desiredSeatPeriodKey: "period-1",
    nextAttemptAt: NOW,
    organizationId,
    priceId: "price_sync",
    subscriptionId,
    subscriptionItemId,
  });
  return { organizationId, subscriptionId, subscriptionItemId };
}

function stripeFetch(input: {
  readonly organizationId: string;
  readonly postStatuses?: readonly number[];
  readonly quantity: number;
  readonly requests: StripeRequest[];
  readonly status?: string;
  readonly subscriptionItemId: string;
}): typeof fetch {
  const statuses = [...(input.postStatuses ?? [])];
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = String(request);
    if ((init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify({
          id: "sub_test",
          status: input.status ?? "active",
          current_period_start: 1_783_036_800,
          current_period_end: 1_785_715_200,
          metadata: { orgId: input.organizationId, userId: "user-1" },
          items: {
            data: [
              {
                id: input.subscriptionItemId,
                quantity: input.quantity,
                price: { id: "price_sync" },
              },
            ],
          },
        }),
      );
    }
    input.requests.push({
      body: String(init?.body ?? ""),
      idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
      url,
    });
    return new Response("{}", { status: statuses.shift() ?? 200 });
  }) as typeof fetch;
}

async function runOne(input: {
  readonly organizationId: string;
  readonly postStatuses?: readonly number[];
  readonly providerQuantity: number;
  readonly requests: StripeRequest[];
  readonly status?: string;
  readonly subscriptionItemId: string;
  readonly now?: Date;
}) {
  return runStripeSeatSynchronization(
    getDefaultApiServiceRuntime(),
    { limit: 1, now: input.now ?? NOW },
    {
      stripe: {
        env: STRIPE_ENV,
        fetchImpl: stripeFetch({
          organizationId: input.organizationId,
          ...(input.postStatuses ? { postStatuses: input.postStatuses } : {}),
          quantity: input.providerQuantity,
          requests: input.requests,
          ...(input.status ? { status: input.status } : {}),
          subscriptionItemId: input.subscriptionItemId,
        }),
      },
    },
  );
}

test("removal lowers renewal quantity without creating a credit", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 1,
  });
  const requests: StripeRequest[] = [];
  expect(
    await runOne({
      ...state,
      providerQuantity: 2,
      requests,
    }),
  ).toEqual({ attempted: 1, failed: 0, synced: 1 });
  expect(requests.map((request) => request.body)).toEqual([
    "quantity=1&proration_behavior=none",
  ]);
});

test("a replacement restores already-paid capacity without proration", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 2,
    desiredRenewalQuantity: 2,
  });
  const requests: StripeRequest[] = [];
  await runOne({ ...state, providerQuantity: 1, requests });
  expect(requests.map((request) => request.body)).toEqual([
    "quantity=2&proration_behavior=none",
  ]);
});

test("growth restores the paid baseline before prorating only new capacity", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 3,
  });
  const requests: StripeRequest[] = [];
  await runOne({ ...state, providerQuantity: 1, requests });
  expect(requests.map((request) => request.body)).toEqual([
    "quantity=2&proration_behavior=none",
    "quantity=3&proration_behavior=create_prorations",
    "quantity=3&proration_behavior=none",
  ]);
  const [saved] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  expect(saved).toMatchObject({
    appliedPaidCapacity: 3,
    appliedRevision: 1,
    inFlightOperationId: null,
    observedQuantity: 3,
  });
});

test("a failed capacity update retries with the sticky idempotency key", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 3,
  });
  const firstRequests: StripeRequest[] = [];
  expect(
    await runOne({
      ...state,
      postStatuses: [200, 500],
      providerQuantity: 1,
      requests: firstRequests,
    }),
  ).toEqual({ attempted: 1, failed: 1, synced: 0 });
  const firstCapacityKey = firstRequests[1]?.idempotencyKey;
  const [failedState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  expect(failedState?.inFlightOperationId).not.toBeNull();

  const retryRequests: StripeRequest[] = [];
  await runOne({
    ...state,
    now: failedState?.nextAttemptAt ?? NOW,
    providerQuantity: 2,
    requests: retryRequests,
  });
  expect(retryRequests[0]?.idempotencyKey).toBe(firstCapacityKey);
  const [syncedState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  expect(syncedState).toMatchObject({
    appliedPaidCapacity: 3,
    attemptCount: 0,
    inFlightOperationId: null,
    observedQuantity: 3,
  });
});

test("a sticky target never lets newer capacity bypass proration", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 4,
    desiredRenewalQuantity: 4,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({
      inFlightOperationId: "seat-operation-3",
      inFlightTargetCapacity: 3,
    })
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );

  const firstRequests: StripeRequest[] = [];
  await runOne({ ...state, providerQuantity: 2, requests: firstRequests });
  expect(firstRequests.map((request) => request.body)).toEqual([
    "quantity=3&proration_behavior=create_prorations",
    "quantity=3&proration_behavior=none",
  ]);

  const secondRequests: StripeRequest[] = [];
  await runOne({ ...state, providerQuantity: 3, requests: secondRequests });
  expect(secondRequests.map((request) => request.body)).toEqual([
    "quantity=4&proration_behavior=create_prorations",
    "quantity=4&proration_behavior=none",
  ]);
});

test("past-due subscriptions retry without creating seat prorations", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 3,
  });
  const requests: StripeRequest[] = [];

  expect(
    await runOne({
      ...state,
      providerQuantity: 2,
      requests,
      status: "past_due",
    }),
  ).toEqual({ attempted: 1, failed: 1, synced: 0 });
  expect(requests).toEqual([]);
  const [failedState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  expect(failedState).toMatchObject({
    attemptCount: 1,
    lastError:
      "Stripe subscription status past_due cannot accept seat prorations",
  });
});

test("a provider period rollover rebinds before any Stripe update", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 3,
  });
  await db
    .update(organizationBillingStripeSeats)
    .set({
      billingPeriodEndsAt: new Date("2026-07-01T00:00:00.000Z"),
      billingPeriodStartsAt: new Date("2026-06-01T00:00:00.000Z"),
    })
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  const requests: StripeRequest[] = [];

  expect(await runOne({ ...state, providerQuantity: 2, requests })).toEqual({
    attempted: 1,
    failed: 0,
    synced: 0,
  });
  expect(requests).toEqual([]);
  const [reboundState] = await db
    .select()
    .from(organizationBillingStripeSeats)
    .where(
      eq(organizationBillingStripeSeats.organizationId, state.organizationId),
    );
  expect(reboundState).toMatchObject({
    billingPeriodEndsAt: PROVIDER_PERIOD_END,
    billingPeriodStartsAt: PROVIDER_PERIOD_START,
    inFlightOperationId: null,
    lastError: null,
    leaseId: null,
  });

  const retryRequests: StripeRequest[] = [];
  expect(
    await runOne({
      ...state,
      providerQuantity: 2,
      requests: retryRequests,
    }),
  ).toEqual({ attempted: 1, failed: 0, synced: 1 });
  expect(retryRequests.map((request) => request.body)).toContain(
    "quantity=3&proration_behavior=create_prorations",
  );
});

test("disabled billing rows cannot be claimed for Stripe updates", async () => {
  const state = await insertState({
    appliedPaidCapacity: 2,
    desiredPaidCapacity: 3,
    desiredRenewalQuantity: 3,
  });
  await db
    .update(organizationBilling)
    .set({ status: "disabled" })
    .where(eq(organizationBilling.organizationId, state.organizationId));
  const requests: StripeRequest[] = [];

  expect(await runOne({ ...state, providerQuantity: 2, requests })).toEqual({
    attempted: 0,
    failed: 0,
    synced: 0,
  });
  expect(requests).toEqual([]);
});
