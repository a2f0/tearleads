import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents, users } from "@tearleads/api-shared/schema";
import { createTestUser, type TestUser } from "@tearleads/bob-and-alice";
import { isOrganizationBillingHistoryResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "../../../test/helpers/authenticate";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

function authHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

/** Inserts one audit row like the webhook workflow records after processing. */
async function insertWebhookEvent(input: {
  appUserId: string;
  eventTimestamp: Date;
  eventType: string;
  organizationId: string;
  outcome: "applied" | "ignored";
  productId?: string | null;
  transactionId?: string | null;
}): Promise<void> {
  await db.insert(revenuecatWebhookEvents).values({
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    appUserId: input.appUserId,
    productId: input.productId ?? null,
    transactionId: input.transactionId ?? null,
    originalTransactionId: null,
    organizationId: input.organizationId,
    outcome: input.outcome,
    eventTimestamp: input.eventTimestamp,
    purchasedAt: null,
    expirationAt: null,
  });
}

test("an org member reads billing history newest-first, scoped to the org", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);
  const other = createTestUser();
  const otherOrganizationId = await registerAndAuthenticate(other);
  const base = Date.parse("2026-07-01T00:00:00.000Z");

  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base),
    eventType: "INITIAL_PURCHASE",
    organizationId,
    outcome: "applied",
    productId: "sync_monthly",
    transactionId: "transaction-1",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 60_000),
    eventType: "CANCELLATION",
    organizationId,
    outcome: "ignored",
  });
  await insertWebhookEvent({
    appUserId: admin.userId,
    eventTimestamp: new Date(base + 120_000),
    eventType: "RENEWAL",
    organizationId,
    outcome: "applied",
    productId: "sync_monthly",
    transactionId: "transaction-2",
  });
  // Another org's event must never appear in this org's history.
  await insertWebhookEvent({
    appUserId: other.userId,
    eventTimestamp: new Date(base + 180_000),
    eventType: "INITIAL_PURCHASE",
    organizationId: otherOrganizationId,
    outcome: "applied",
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
  expect(history.entries.map((entry) => entry.eventType)).toEqual([
    "RENEWAL",
    "CANCELLATION",
    "INITIAL_PURCHASE",
  ]);
  expect(history.entries.map((entry) => entry.outcome)).toEqual([
    "applied",
    "ignored",
    "applied",
  ]);
  expect(history.entries[0]?.occurredAt).toBe(
    new Date(base + 120_000).toISOString(),
  );
  expect(history.entries[0]?.productId).toBe("sync_monthly");
  expect(history.entries[0]?.transactionId).toBe("transaction-2");
  expect(history.entries[1]?.productId).toBeNull();
  expect(history.entries[1]?.transactionId).toBeNull();
});

test("an organization with no billing events returns an empty history", async () => {
  const admin = createTestUser();
  const organizationId = await registerAndAuthenticate(admin);

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

test("an invalid organization id is rejected", async () => {
  const admin = createTestUser();
  await registerAndAuthenticate(admin);

  const response = await routeApp.request(
    "/organizations/not-a-uuid/billing/history",
    { headers: authHeader(admin) },
  );
  expect(response.status).toBe(400);
});
