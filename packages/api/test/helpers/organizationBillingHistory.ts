import { db } from "@tearleads/api-shared/postgres";
import {
  organizationBillingInvoiceEvents,
  organizationBillingSeatEvents,
  revenuecatWebhookEvents,
  users,
} from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { authenticate } from "./authenticate";
import { registerUser } from "./registerUser";

export async function registerAndAuthenticate(user: TestUser): Promise<string> {
  await registerUser(user);
  await authenticate(user);

  const [row] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, user.userId));

  invariant(row, "expected registered user row");
  return row.organizationId;
}

export function billingAuthHeader(user: TestUser): { Authorization: string } {
  return { Authorization: `Bearer ${user.token}` };
}

export async function clearBillingHistory(
  organizationId: string,
): Promise<void> {
  await db
    .delete(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId));
  await db
    .delete(organizationBillingSeatEvents)
    .where(eq(organizationBillingSeatEvents.organizationId, organizationId));
  await db
    .delete(revenuecatWebhookEvents)
    .where(eq(revenuecatWebhookEvents.organizationId, organizationId));
}

/** Inserts one audit row like the webhook workflow records after processing. */
export async function insertWebhookEvent(input: {
  appUserId: string;
  eventTimestamp: Date;
  eventId?: string;
  eventType: string;
  id?: string;
  organizationId: string;
  outcome: "applied" | "ignored";
  periodEndsAt?: Date | null;
  periodStartsAt?: Date | null;
  productId?: string | null;
  store?: string | null;
  transactionId?: string | null;
}): Promise<void> {
  await db.insert(revenuecatWebhookEvents).values({
    id: input.id,
    eventId: input.eventId ?? crypto.randomUUID(),
    eventType: input.eventType,
    appUserId: input.appUserId,
    productId: input.productId ?? null,
    store: input.store ?? null,
    transactionId: input.transactionId ?? null,
    originalTransactionId: null,
    organizationId: input.organizationId,
    outcome: input.outcome,
    eventTimestamp: input.eventTimestamp,
    purchasedAt: input.periodStartsAt ?? null,
    expirationAt: input.periodEndsAt ?? null,
  });
}

export async function insertSeatEvent(input: {
  activeSeatCount: number;
  createdAt: Date;
  eventType:
    | "seat_assigned"
    | "licensed_seat_count_initialized"
    | "licensed_seat_count_increased"
    | "licensed_seat_count_reset";
  id?: string;
  organizationId: string;
  periodEndsAt?: Date | null;
  periodStartsAt?: Date | null;
  seatCount: number;
  seatDelta: number;
  sourceId: string;
  sourceType: "provider_event" | "principal_state";
}): Promise<void> {
  await db.insert(organizationBillingSeatEvents).values({
    id: input.id,
    activeSeatCount: input.activeSeatCount,
    billingPeriodEndsAt: input.periodEndsAt ?? null,
    billingPeriodStartsAt: input.periodStartsAt ?? null,
    createdAt: input.createdAt,
    eventType: input.eventType,
    licensedSeatCount: input.seatCount,
    organizationId: input.organizationId,
    quantityDelta: input.seatDelta,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
  });
}

export async function insertInvoiceEvent(input: {
  id?: string;
  invoiceId: string;
  occurredAt: Date;
  organizationId: string;
  periodEndsAt?: Date | null;
  periodStartsAt?: Date | null;
  seatCount: number;
}): Promise<void> {
  await db.insert(organizationBillingInvoiceEvents).values({
    id: input.id,
    billingReason: "subscription_cycle",
    currency: "usd",
    interval: "month",
    intervalCount: 3,
    invoiceId: input.invoiceId,
    occurredAt: input.occurredAt,
    organizationId: input.organizationId,
    periodEndsAt: input.periodEndsAt ?? null,
    periodStartsAt: input.periodStartsAt ?? null,
    priceId: "price_monthly",
    providerEventId: `evt_${input.invoiceId}`,
    seatCount: input.seatCount,
    subscriptionId: "sub_1",
    totalAmount: input.seatCount * 1_200,
    unitAmount: 1_200,
  });
}
