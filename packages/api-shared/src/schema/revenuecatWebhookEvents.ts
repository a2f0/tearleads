import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "./columns";

/**
 * Processed RevenueCat webhook events, keyed by the provider event id.
 *
 * RevenueCat delivers subscription lifecycle events (initial purchase, renewal,
 * expiration, …) to `POST /billing/revenuecat/webhook` and retries on any
 * non-2xx response, so the same event id can arrive more than once. This table
 * makes webhook processing idempotent: the handler claims an event by inserting
 * its `eventId` (conflict = already processed and skipped), and the row doubles
 * as a lightweight audit trail of what the webhook resolved and did.
 *
 * Columns:
 * - `eventId`: RevenueCat's globally-unique event id. Uniquely indexed; a second
 *   delivery of the same id is a no-op.
 * - `eventType`: RevenueCat event type (e.g. `INITIAL_PURCHASE`, `EXPIRATION`).
 * - `appUserId`: RevenueCat App User ID on the event. Our client sets this to the
 *   buyer's global user id.
 * - `productId`: Provider product reported by RevenueCat, when present; for a
 *   `PRODUCT_CHANGE`, this stores RevenueCat's destination `new_product_id`.
 * - `transactionId` / `originalTransactionId`: Provider transaction ids used to
 *   correlate the applied billing row back to RevenueCat/store history.
 * - `organizationId`: Organization the event was applied to, resolved from the
 *   `orgId` subscriber attribute. Null when the event carried no resolvable org.
 * - `sourceOrganizationId`: Previous owner for a `TRANSFER` event. This lets
 *   both personal organizations retain an explicit move in billing history.
 * - `outcome`: How the handler dispositioned the event (`applied`/`ignored`).
 * - `eventTimestamp`: Provider-reported event time. Used to reject stale,
 *   out-of-order deliveries: a transition is not applied when a newer event has
 *   already been applied to the same organization.
 * - `purchasedAt` / `expirationAt`: Provider-reported billing period bounds, when
 *   the event carries them.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const revenuecatWebhookEvents = pgTable(
  "revenuecat_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    appUserId: text("app_user_id").notNull(),
    productId: text("product_id"),
    transactionId: text("transaction_id"),
    originalTransactionId: text("original_transaction_id"),
    organizationId: uuid("organization_id"),
    sourceOrganizationId: uuid("source_organization_id"),
    outcome: text("outcome").notNull(),
    eventTimestamp: timestamp("event_timestamp").notNull(),
    purchasedAt: timestamp("purchased_at"),
    expirationAt: timestamp("expiration_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("revenuecat_webhook_events_event_id_idx").on(table.eventId),
    index("revenuecat_webhook_events_org_idx").on(table.organizationId),
    index("revenuecat_webhook_events_source_org_idx").on(
      table.sourceOrganizationId,
    ),
  ],
);
