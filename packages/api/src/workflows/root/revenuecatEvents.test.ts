import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { db } from "@tearleads/api-shared/postgres";
import { revenuecatWebhookEvents } from "@tearleads/api-shared/schema";
import { inArray } from "drizzle-orm";
import {
  listRootOrganizationRevenuecatEvents,
  listRootRevenuecatEventsReport,
} from "./revenuecatEvents";

// The report lists deliveries across every organization, newest first, and
// other suites store deliveries in this database too. These fixtures are dated
// far in the future so they lead the report, and none outlives its test.
const BASE = new Date("2990-01-01T00:00:00.000Z").getTime();
const HOUR = 60 * 60 * 1000;
const inserted: string[] = [];
afterEach(async () => {
  const ids = inserted.splice(0);
  if (ids.length === 0) return;
  await db
    .delete(revenuecatWebhookEvents)
    .where(inArray(revenuecatWebhookEvents.id, ids));
});

type Delivery = typeof revenuecatWebhookEvents.$inferInsert;

async function deliver(
  hour: number,
  fields: Partial<Omit<Delivery, "eventTimestamp">> = {},
): Promise<string> {
  const id = randomUUID();
  inserted.push(id);
  await db.insert(revenuecatWebhookEvents).values({
    appUserId: randomUUID(),
    eventId: `evt_${id}`,
    eventType: "RENEWAL",
    outcome: "applied",
    ...fields,
    eventTimestamp: new Date(BASE + hour * HOUR),
    id,
  });
  return id;
}

test("an organization's deliveries include transfers away from it, by role", async () => {
  const organizationId = randomUUID();
  const elsewhere = randomUUID();
  const applied = await deliver(1, { organizationId });
  const transferredAway = await deliver(2, {
    eventType: "TRANSFER",
    organizationId: elsewhere,
    sourceOrganizationId: organizationId,
  });
  const ignored = await deliver(3, { organizationId, outcome: "ignored" });
  await deliver(4, { organizationId: elsewhere });

  const { events, nextAfterId } = await listRootOrganizationRevenuecatEvents(
    db,
    { limit: 10, organizationId },
  );

  expect(events.map(({ id, role }) => [id, role])).toEqual([
    [ignored, "target"],
    [transferredAway, "source"],
    [applied, "target"],
  ]);
  expect(nextAfterId).toBeNull();
});

test("an organization's deliveries page newest first without gaps or repeats", async () => {
  const organizationId = randomUUID();
  const older: string[] = [];
  for (let hour = 4; hour >= 1; hour -= 1) {
    older.push(await deliver(hour, { organizationId }));
  }
  // Deliveries at one instant still page in a stable order: id descending,
  // which for lowercase UUIDs is string order in every dialect.
  const tied = [
    await deliver(5, { organizationId }),
    await deliver(5, { organizationId }),
  ].sort((left, right) => (left < right ? 1 : -1));
  const newestFirst = [...tied, ...older];

  const seen: string[] = [];
  let afterId: string | undefined;
  for (;;) {
    const page = await listRootOrganizationRevenuecatEvents(db, {
      afterId,
      limit: 2,
      organizationId,
    });
    seen.push(...page.events.map((event) => event.id));
    if (page.nextAfterId === null) break;
    afterId = page.nextAfterId;
  }

  expect(seen).toEqual(newestFirst);
});

test("the report lists unmatched, ignored, or both dispositions", async () => {
  const unmatched = await deliver(10, { organizationId: null });
  const ignored = await deliver(11, {
    organizationId: randomUUID(),
    outcome: "ignored",
  });
  const unmatchedAndIgnored = await deliver(12, {
    organizationId: null,
    outcome: "ignored",
  });
  const applied = await deliver(13, { organizationId: randomUUID() });

  const lead = async (
    disposition: "unmatched" | "ignored" | "both",
    count: number,
  ) =>
    (
      await listRootRevenuecatEventsReport(db, { disposition, limit: count })
    ).events.map((event) => event.id);

  expect(await lead("unmatched", 2)).toEqual([unmatchedAndIgnored, unmatched]);
  expect(await lead("ignored", 2)).toEqual([unmatchedAndIgnored, ignored]);
  expect(await lead("both", 3)).toEqual([
    unmatchedAndIgnored,
    ignored,
    unmatched,
  ]);
  for (const disposition of ["unmatched", "ignored", "both"] as const) {
    expect(await lead(disposition, 4)).not.toContain(applied);
  }
});

test("report rows carry the delivery's evidence", async () => {
  const id = await deliver(20, {
    appUserId: "buyer-1",
    currency: "EUR",
    environment: "PRODUCTION",
    expirationAt: new Date(BASE + 30 * 24 * HOUR),
    organizationId: null,
    originalTransactionId: "otx-1",
    periodType: "NORMAL",
    priceInPurchasedCurrencyMinor: 499,
    productId: "sync_monthly",
    purchasedAt: new Date(BASE),
    store: "APP_STORE",
    transactionId: "tx-1",
  });

  const [event] = (
    await listRootRevenuecatEventsReport(db, {
      disposition: "unmatched",
      limit: 1,
    })
  ).events;

  expect(event).toMatchObject({
    appUserId: "buyer-1",
    currency: "EUR",
    environment: "PRODUCTION",
    eventId: `evt_${id}`,
    eventTimestamp: new Date(BASE + 20 * HOUR).toISOString(),
    expirationAt: new Date(BASE + 30 * 24 * HOUR).toISOString(),
    id,
    organizationId: null,
    originalTransactionId: "otx-1",
    outcome: "applied",
    periodType: "NORMAL",
    priceInPurchasedCurrencyMinor: 499,
    productId: "sync_monthly",
    purchasedAt: new Date(BASE).toISOString(),
    sourceOrganizationId: null,
    store: "APP_STORE",
    transactionId: "tx-1",
  });
  expect(typeof event?.createdAt).toBe("string");
});
