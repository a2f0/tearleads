import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingHistoryResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import {
  billingAuthHeader as authHeader,
  clearBillingHistory,
  insertInvoiceEvent,
  insertSeatEvent,
  insertWebhookEvent,
  registerAndAuthenticate,
} from "../../../test/helpers/organizationBillingHistory";
import { addMemberGroupUser } from "../../../test/helpers/organizationMember";
import { routeApp } from "../../routeApp";

test("an org admin reads meaningful mixed billing history newest-first", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const other = createTestUser();
  const otherOrganizationId = await registerAndAuthenticate(other);
  await clearBillingHistory(organizationId);
  await clearBillingHistory(otherOrganizationId);
  const base = Date.parse("2026-07-01T00:00:00.000Z");
  const periodStartsAt = new Date(base);
  const periodEndsAt = new Date("2026-08-01T00:00:00.000Z");
  const providerEventId = "rc-renewal-1";

  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 60_000),
    eventId: providerEventId,
    eventType: "RENEWAL",
    id: "00000000-0000-4000-8000-000000000010",
    organizationId,
    outcome: "applied",
    productId: "sync_team_10_monthly_staging:monthly",
    store: "PLAY_STORE",
    transactionId: "transaction-1",
    periodStartsAt,
    periodEndsAt,
  });
  await insertSeatEvent({
    activeSeatCount: 5,
    createdAt: new Date(base + 120_000),
    eventType: "licensed_seat_count_increased",
    id: "00000000-0000-4000-8000-000000000020",
    organizationId,
    periodEndsAt,
    periodStartsAt,
    seatCount: 5,
    seatDelta: 1,
    sourceId: "principal-change-1",
    sourceType: "principal_state",
  });
  // Equal timestamps are resolved by descending stable id across sources.
  await insertInvoiceEvent({
    id: "00000000-0000-4000-8000-000000000030",
    invoiceId: "in_1",
    occurredAt: new Date(base + 120_000),
    organizationId,
    periodEndsAt,
    periodStartsAt,
    seatCount: 5,
  });
  // Assignment/release noise is intentionally excluded.
  await insertSeatEvent({
    activeSeatCount: 5,
    createdAt: new Date(base + 180_000),
    eventType: "seat_assigned",
    organizationId,
    seatCount: 5,
    seatDelta: 0,
    sourceId: "principal-change-2",
    sourceType: "principal_state",
  });
  // Rows from every source are organization-scoped.
  await insertWebhookEvent({
    appUserId: other.userId,
    eventTimestamp: new Date(base + 240_000),
    eventType: "INITIAL_PURCHASE",
    organizationId: otherOrganizationId,
    outcome: "applied",
  });
  await insertSeatEvent({
    activeSeatCount: 9,
    createdAt: new Date(base + 240_000),
    eventType: "licensed_seat_count_initialized",
    organizationId: otherOrganizationId,
    seatCount: 9,
    seatDelta: 9,
    sourceId: "other-principal-change",
    sourceType: "principal_state",
  });
  await insertInvoiceEvent({
    invoiceId: "in_other",
    occurredAt: new Date(base + 240_000),
    organizationId: otherOrganizationId,
    seatCount: 9,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(admin) },
  );
  expect(response.status).toBe(200);
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.organizationId).toBe(organizationId);
  expect(history.entries).toEqual([
    {
      id: "00000000-0000-4000-8000-000000000030",
      category: "invoice",
      provider: "stripe",
      eventType: "INVOICE_PAID",
      outcome: "applied",
      occurredAt: new Date(base + 120_000).toISOString(),
      productId: null,
      transactionId: null,
      invoiceId: "in_1",
      subscriptionId: "sub_1",
      billingReason: "subscription_cycle",
      seatCount: 5,
      seatDelta: null,
      activeSeatCount: null,
      priceId: "price_monthly",
      unitAmount: 1_200,
      currency: "usd",
      interval: "month",
      intervalCount: 3,
      totalAmount: 6_000,
      periodStartsAt: periodStartsAt.toISOString(),
      periodEndsAt: periodEndsAt.toISOString(),
    },
    {
      id: "00000000-0000-4000-8000-000000000020",
      category: "seat",
      provider: "internal",
      eventType: "licensed_seat_count_increased",
      outcome: "applied",
      occurredAt: new Date(base + 120_000).toISOString(),
      productId: null,
      transactionId: null,
      invoiceId: null,
      subscriptionId: null,
      billingReason: null,
      seatCount: 5,
      seatDelta: 1,
      activeSeatCount: 5,
      priceId: null,
      unitAmount: null,
      currency: null,
      interval: null,
      intervalCount: null,
      totalAmount: null,
      periodStartsAt: periodStartsAt.toISOString(),
      periodEndsAt: periodEndsAt.toISOString(),
    },
    {
      id: "00000000-0000-4000-8000-000000000010",
      category: "lifecycle",
      provider: "revenuecat",
      eventType: "RENEWAL",
      outcome: "applied",
      occurredAt: new Date(base + 60_000).toISOString(),
      productId: "sync_team_10_monthly_staging:monthly",
      transactionId: "transaction-1",
      invoiceId: null,
      subscriptionId: null,
      billingReason: null,
      seatCount: 10,
      seatDelta: null,
      activeSeatCount: null,
      priceId: null,
      unitAmount: 2_000,
      currency: "usd",
      interval: "month",
      intervalCount: 1,
      totalAmount: null,
      periodStartsAt: periodStartsAt.toISOString(),
      periodEndsAt: periodEndsAt.toISOString(),
    },
  ]);
});

test("an unmatched provider seat event remains visible as seat activity", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await clearBillingHistory(organizationId);
  const id = "00000000-0000-4000-8000-000000000040";

  await insertSeatEvent({
    activeSeatCount: 3,
    createdAt: new Date("2026-07-02T00:00:00.000Z"),
    eventType: "licensed_seat_count_increased",
    id,
    organizationId,
    seatCount: 3,
    seatDelta: 1,
    sourceId: "missing-lifecycle-event",
    sourceType: "provider_event",
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(admin) },
  );
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.entries).toHaveLength(1);
  expect(history.entries[0]).toMatchObject({
    id,
    category: "seat",
    provider: "internal",
    seatCount: 3,
    seatDelta: 1,
  });
});

test("a lifecycle event is enriched beyond the recent seat window", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await clearBillingHistory(organizationId);
  const base = Date.parse("2026-07-03T00:00:00.000Z");
  const lifecycleId = "00000000-0000-4000-8000-000000000050";
  const seatId = "00000000-0000-4000-8000-000000000051";
  const providerEventId = "older-seat-snapshot";

  await insertSeatEvent({
    activeSeatCount: 6,
    createdAt: new Date(base),
    eventType: "licensed_seat_count_reset",
    id: seatId,
    organizationId,
    seatCount: 7,
    seatDelta: 2,
    sourceId: providerEventId,
    sourceType: "provider_event",
  });
  for (let index = 1; index <= 50; index += 1) {
    await insertSeatEvent({
      activeSeatCount: index,
      createdAt: new Date(base + index * 1_000),
      eventType: "licensed_seat_count_increased",
      organizationId,
      seatCount: index,
      seatDelta: 1,
      sourceId: `principal-${index}`,
      sourceType: "principal_state",
    });
  }
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventId: providerEventId,
    eventTimestamp: new Date(base + 60_000),
    eventType: "RENEWAL",
    id: lifecycleId,
    organizationId,
    outcome: "applied",
    productId: "sync_team_10_monthly_staging:monthly",
    store: "PLAY_STORE",
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(admin) },
  );
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.entries).toHaveLength(50);
  expect(history.entries[0]).toMatchObject({
    id: lifecycleId,
    productId: "sync_team_10_monthly_staging:monthly",
    // The durable snapshot wins over the catalog's ten-seat tier in history.
    seatCount: 7,
    seatDelta: 2,
    activeSeatCount: 6,
  });
  expect(history.entries.some((entry) => entry.id === seatId)).toBe(false);
});

test("an organization with no billing events returns an empty history", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await clearBillingHistory(organizationId);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(admin) },
  );
  expect(response.status).toBe(200);
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.organizationId).toBe(organizationId);
  expect(history.entries).toEqual([]);
});

test("a non-member cannot read another org's billing history", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const intruder = createTestUser();
  await registerAndAuthenticate(intruder);

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(intruder) },
  );
  expect(response.status).toBe(403);
});

test("a direct organization member cannot read admin-only billing history", async () => {
  const owner = createTestUser();
  const organizationId = await registerAndAuthenticate(owner);
  const member = createTestUser();
  await registerAndAuthenticate(member);
  await addMemberGroupUser({
    actor: owner,
    memberUserId: member.userId,
    organizationId,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: authHeader(member) },
  );
  expect(response.status).toBe(403);
});

test("an invalid organization id is rejected", async () => {
  const admin = createTestUser();
  await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    "/organizations/not-a-uuid/billing/history",
    { headers: authHeader(admin) },
  );
  expect(response.status).toBe(400);
});
