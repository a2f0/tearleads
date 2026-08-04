import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingHistoryResponse } from "@tearleads/validators/response";
import invariant from "invariant";
import {
  billingAuthHeader,
  clearBillingHistory,
  insertSeatEvent,
  insertWebhookEvent,
  registerAndAuthenticate,
} from "../../../test/helpers/organizationBillingHistory";
import { routeApp } from "../../routeApp";

test("catalog facts require an applied recognized grant", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  await clearBillingHistory(organizationId);
  const base = Date.parse("2026-07-04T00:00:00.000Z");
  const expirationEventId = "revoked-tier";

  await insertWebhookEvent({
    appUserId: admin.userId,
    eventId: expirationEventId,
    eventTimestamp: new Date(base),
    eventType: "EXPIRATION",
    organizationId,
    outcome: "applied",
    productId: "sync_team_10_monthly_staging:monthly",
    store: "PLAY_STORE",
  });
  await insertSeatEvent({
    activeSeatCount: 0,
    createdAt: new Date(base),
    eventType: "licensed_seat_count_reset",
    organizationId,
    seatCount: 0,
    seatDelta: -10,
    sourceId: expirationEventId,
    sourceType: "provider_event",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 1_000),
    eventType: "INITIAL_PURCHASE",
    id: "00000000-0000-4000-8000-000000000061",
    organizationId,
    outcome: "ignored",
    productId: "sync_team_10_monthly_staging:monthly",
    store: "PLAY_STORE",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 2_000),
    eventType: "RENEWAL",
    id: "00000000-0000-4000-8000-000000000062",
    organizationId,
    outcome: "applied",
    productId: "unrecognized_product",
    store: "PLAY_STORE",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 3_000),
    eventType: "INITIAL_PURCHASE",
    id: "00000000-0000-4000-8000-000000000063",
    organizationId,
    outcome: "applied",
    productId: "sync_team_5_monthly",
    store: "PROMOTIONAL",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 4_000),
    eventType: "INITIAL_PURCHASE",
    id: "00000000-0000-4000-8000-000000000064",
    organizationId,
    outcome: "applied",
    productId: "sync_team_10_monthly_staging:monthly",
    store: null,
  });

  const response = await routeApp.request(
    `/organizations/${organizationId}/billing/history`,
    { headers: billingAuthHeader(admin) },
  );
  const history = await response.json();
  invariant(
    isOrganizationBillingHistoryResponse(history),
    "expected billing history response",
  );
  expect(history.entries).toHaveLength(5);
  expect(history.entries[0]).toMatchObject({
    productId: "sync_team_10_monthly_staging:monthly",
    seatCount: null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
  });
  expect(history.entries[1]).toMatchObject({
    productId: "sync_team_5_monthly",
    seatCount: null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
  });
  expect(history.entries[2]).toMatchObject({
    productId: "unrecognized_product",
    seatCount: null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
  });
  expect(history.entries[3]).toMatchObject({
    outcome: "ignored",
    seatCount: null,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
  });
  expect(history.entries[4]).toMatchObject({
    eventType: "EXPIRATION",
    seatCount: 0,
    seatDelta: -10,
    unitAmount: null,
    currency: null,
    interval: null,
    intervalCount: null,
  });
});
