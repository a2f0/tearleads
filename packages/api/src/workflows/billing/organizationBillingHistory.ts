import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import {
  organizationBillingInvoiceEvents,
  organizationBillingSeatEvents,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { OrganizationBillingHistoryEvent } from "../../billing/organizationBilling";
import { requireDirectOrganizationAccess } from "../organizations/access";

/** Newest merged events returned to a client; older audit rows stay durable. */
const BILLING_HISTORY_EVENT_LIMIT = 50;

const LICENSED_SEAT_EVENT_TYPES = [
  "licensed_seat_count_initialized",
  "licensed_seat_count_increased",
  "licensed_seat_count_reset",
] as const;

const LIFECYCLE_SEAT_CORRELATION_LIMIT =
  BILLING_HISTORY_EVENT_LIMIT * LICENSED_SEAT_EVENT_TYPES.length;

async function loadLifecycleHistory(
  executor: DatabaseSession,
  organizationId: string,
) {
  return executor
    .select({
      id: revenuecatWebhookEvents.id,
      organizationId: revenuecatWebhookEvents.organizationId,
      sourceOrganizationId: revenuecatWebhookEvents.sourceOrganizationId,
      providerEventId: revenuecatWebhookEvents.eventId,
      eventType: revenuecatWebhookEvents.eventType,
      outcome: revenuecatWebhookEvents.outcome,
      occurredAt: revenuecatWebhookEvents.eventTimestamp,
      productId: revenuecatWebhookEvents.productId,
      transactionId: revenuecatWebhookEvents.transactionId,
      periodStartsAt: revenuecatWebhookEvents.purchasedAt,
      periodEndsAt: revenuecatWebhookEvents.expirationAt,
    })
    .from(revenuecatWebhookEvents)
    .where(
      or(
        eq(revenuecatWebhookEvents.organizationId, organizationId),
        eq(revenuecatWebhookEvents.sourceOrganizationId, organizationId),
      ),
    )
    .orderBy(
      desc(revenuecatWebhookEvents.eventTimestamp),
      desc(revenuecatWebhookEvents.id),
    )
    .limit(BILLING_HISTORY_EVENT_LIMIT);
}

type LifecycleHistoryRow = Awaited<
  ReturnType<typeof loadLifecycleHistory>
>[number];
type SeatHistoryRow = Awaited<ReturnType<typeof loadSeatHistory>>[number];
type InvoiceHistoryRow = Awaited<ReturnType<typeof loadInvoiceHistory>>[number];

async function loadSeatHistory(
  executor: DatabaseSession,
  organizationId: string,
) {
  return executor
    .select({
      id: organizationBillingSeatEvents.id,
      eventType: organizationBillingSeatEvents.eventType,
      seatDelta: organizationBillingSeatEvents.quantityDelta,
      seatCount: organizationBillingSeatEvents.licensedSeatCount,
      activeSeatCount: organizationBillingSeatEvents.activeSeatCount,
      periodStartsAt: organizationBillingSeatEvents.billingPeriodStartsAt,
      periodEndsAt: organizationBillingSeatEvents.billingPeriodEndsAt,
      sourceType: organizationBillingSeatEvents.sourceType,
      sourceId: organizationBillingSeatEvents.sourceId,
      occurredAt: organizationBillingSeatEvents.createdAt,
    })
    .from(organizationBillingSeatEvents)
    .where(
      and(
        eq(organizationBillingSeatEvents.organizationId, organizationId),
        inArray(
          organizationBillingSeatEvents.eventType,
          LICENSED_SEAT_EVENT_TYPES,
        ),
      ),
    )
    .orderBy(
      desc(organizationBillingSeatEvents.createdAt),
      desc(organizationBillingSeatEvents.id),
    )
    .limit(BILLING_HISTORY_EVENT_LIMIT);
}

async function loadLifecycleSeatHistory(
  executor: DatabaseSession,
  organizationId: string,
  providerEventIds: readonly string[],
): Promise<SeatHistoryRow[]> {
  if (providerEventIds.length === 0) {
    return [];
  }

  return executor
    .select({
      id: organizationBillingSeatEvents.id,
      eventType: organizationBillingSeatEvents.eventType,
      seatDelta: organizationBillingSeatEvents.quantityDelta,
      seatCount: organizationBillingSeatEvents.licensedSeatCount,
      activeSeatCount: organizationBillingSeatEvents.activeSeatCount,
      periodStartsAt: organizationBillingSeatEvents.billingPeriodStartsAt,
      periodEndsAt: organizationBillingSeatEvents.billingPeriodEndsAt,
      sourceType: organizationBillingSeatEvents.sourceType,
      sourceId: organizationBillingSeatEvents.sourceId,
      occurredAt: organizationBillingSeatEvents.createdAt,
    })
    .from(organizationBillingSeatEvents)
    .where(
      and(
        eq(organizationBillingSeatEvents.organizationId, organizationId),
        eq(organizationBillingSeatEvents.sourceType, "provider_event"),
        inArray(
          organizationBillingSeatEvents.eventType,
          LICENSED_SEAT_EVENT_TYPES,
        ),
        inArray(organizationBillingSeatEvents.sourceId, providerEventIds),
      ),
    )
    .orderBy(
      desc(organizationBillingSeatEvents.createdAt),
      desc(organizationBillingSeatEvents.id),
    )
    .limit(LIFECYCLE_SEAT_CORRELATION_LIMIT);
}

async function loadInvoiceHistory(
  executor: DatabaseSession,
  organizationId: string,
) {
  return executor
    .select({
      id: organizationBillingInvoiceEvents.id,
      invoiceId: organizationBillingInvoiceEvents.invoiceId,
      subscriptionId: organizationBillingInvoiceEvents.subscriptionId,
      billingReason: organizationBillingInvoiceEvents.billingReason,
      seatCount: organizationBillingInvoiceEvents.seatCount,
      priceId: organizationBillingInvoiceEvents.priceId,
      unitAmount: organizationBillingInvoiceEvents.unitAmount,
      currency: organizationBillingInvoiceEvents.currency,
      interval: organizationBillingInvoiceEvents.interval,
      intervalCount: organizationBillingInvoiceEvents.intervalCount,
      totalAmount: organizationBillingInvoiceEvents.totalAmount,
      periodStartsAt: organizationBillingInvoiceEvents.periodStartsAt,
      periodEndsAt: organizationBillingInvoiceEvents.periodEndsAt,
      occurredAt: organizationBillingInvoiceEvents.occurredAt,
    })
    .from(organizationBillingInvoiceEvents)
    .where(eq(organizationBillingInvoiceEvents.organizationId, organizationId))
    .orderBy(
      desc(organizationBillingInvoiceEvents.occurredAt),
      desc(organizationBillingInvoiceEvents.id),
    )
    .limit(BILLING_HISTORY_EVENT_LIMIT);
}

function compareHistoryEvents(
  left: OrganizationBillingHistoryEvent,
  right: OrganizationBillingHistoryEvent,
): number {
  const timeDifference =
    right.eventTimestamp.getTime() - left.eventTimestamp.getTime();
  if (timeDifference !== 0) {
    return timeDifference;
  }
  return left.id < right.id ? 1 : left.id === right.id ? 0 : -1;
}

function correlatedSeatRows(
  seats: readonly SeatHistoryRow[],
): ReadonlyMap<string, SeatHistoryRow> {
  const result = new Map<string, SeatHistoryRow>();
  for (const seat of seats) {
    if (seat.sourceType === "provider_event" && !result.has(seat.sourceId)) {
      result.set(seat.sourceId, seat);
    }
  }
  return result;
}

function projectLifecycleHistory(
  rows: readonly LifecycleHistoryRow[],
  seatsByProviderEventId: ReadonlyMap<string, SeatHistoryRow>,
  organizationId: string,
): OrganizationBillingHistoryEvent[] {
  return rows.map((row) => {
    const seat = seatsByProviderEventId.get(row.providerEventId);
    // RevenueCat lifecycle events don't carry a trustworthy charged total.
    // The fixed catalog still supplies the plan's capacity and USD list price.
    const tier = getSyncBillingTierForNativeProduct(row.productId);
    return {
      id: row.id,
      category: "lifecycle",
      provider: "revenuecat",
      eventType:
        row.eventType === "TRANSFER"
          ? row.sourceOrganizationId === organizationId
            ? "TRANSFER_OUT"
            : "TRANSFER_IN"
          : row.eventType,
      outcome: row.outcome,
      eventTimestamp: row.occurredAt,
      productId: row.productId,
      transactionId: row.transactionId,
      invoiceId: null,
      subscriptionId: null,
      billingReason: null,
      seatCount: seat?.seatCount ?? tier?.seatLimit ?? null,
      seatDelta: seat?.seatDelta ?? null,
      activeSeatCount: seat?.activeSeatCount ?? null,
      priceId: null,
      unitAmount: tier?.monthlyPriceUsdCents ?? null,
      currency: tier ? "usd" : null,
      interval: tier ? "month" : null,
      intervalCount: tier ? 1 : null,
      totalAmount: null,
      periodStartsAt: seat?.periodStartsAt ?? row.periodStartsAt,
      periodEndsAt: seat?.periodEndsAt ?? row.periodEndsAt,
    };
  });
}

function projectSeatHistory(
  rows: readonly SeatHistoryRow[],
  lifecycleProviderEventIds: ReadonlySet<string>,
): OrganizationBillingHistoryEvent[] {
  return rows
    .filter(
      (row) =>
        row.sourceType !== "provider_event" ||
        !lifecycleProviderEventIds.has(row.sourceId),
    )
    .map((row) => ({
      id: row.id,
      category: "seat",
      provider: "internal",
      eventType: row.eventType,
      outcome: "applied",
      eventTimestamp: row.occurredAt,
      productId: null,
      transactionId: null,
      invoiceId: null,
      subscriptionId: null,
      billingReason: null,
      seatCount: row.seatCount,
      seatDelta: row.seatDelta,
      activeSeatCount: row.activeSeatCount,
      priceId: null,
      unitAmount: null,
      currency: null,
      interval: null,
      intervalCount: null,
      totalAmount: null,
      periodStartsAt: row.periodStartsAt,
      periodEndsAt: row.periodEndsAt,
    }));
}

function projectInvoiceHistory(
  rows: readonly InvoiceHistoryRow[],
): OrganizationBillingHistoryEvent[] {
  return rows.map((row) => ({
    id: row.id,
    category: "invoice",
    provider: "stripe",
    eventType: "INVOICE_PAID",
    outcome: "applied",
    eventTimestamp: row.occurredAt,
    productId: null,
    transactionId: null,
    invoiceId: row.invoiceId,
    subscriptionId: row.subscriptionId,
    billingReason: row.billingReason,
    seatCount: row.seatCount,
    seatDelta: null,
    activeSeatCount: null,
    priceId: row.priceId,
    unitAmount: row.unitAmount,
    currency: row.currency,
    interval: row.interval,
    intervalCount: row.intervalCount,
    totalAmount: row.totalAmount,
    periodStartsAt: row.periodStartsAt,
    periodEndsAt: row.periodEndsAt,
  }));
}

/**
 * Reads all durable, user-meaningful billing history sources and merges them
 * newest first. Provider-triggered seat snapshots enrich the matching
 * RevenueCat lifecycle entry instead of creating a duplicate activity row.
 */
export async function runGetOrganizationBillingHistoryWorkflow(
  db: ApiDatabase,
  organizationId: string,
  sessionUserId: string,
): Promise<OrganizationBillingHistoryEvent[]> {
  return db.transaction(async (tx) => {
    await requireDirectOrganizationAccess({
      executor: tx,
      organizationId,
      requireAdmin: true,
      userId: sessionUserId,
    });

    const lifecycleRows = await loadLifecycleHistory(tx, organizationId);
    const seatRows = await loadSeatHistory(tx, organizationId);
    const invoiceRows = await loadInvoiceHistory(tx, organizationId);
    const lifecycleProviderEventIds = new Set(
      lifecycleRows.map((row) => row.providerEventId),
    );
    const lifecycleSeatRows = await loadLifecycleSeatHistory(
      tx,
      organizationId,
      [...lifecycleProviderEventIds],
    );
    const seatsByProviderEventId = correlatedSeatRows(lifecycleSeatRows);
    const lifecycleEvents = projectLifecycleHistory(
      lifecycleRows,
      seatsByProviderEventId,
      organizationId,
    );
    const seatEvents = projectSeatHistory(seatRows, lifecycleProviderEventIds);
    const invoiceEvents = projectInvoiceHistory(invoiceRows);

    return [...lifecycleEvents, ...seatEvents, ...invoiceEvents]
      .sort(compareHistoryEvents)
      .slice(0, BILLING_HISTORY_EVENT_LIMIT);
  });
}
