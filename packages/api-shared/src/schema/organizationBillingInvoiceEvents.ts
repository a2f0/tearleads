import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

export type OrganizationBillingInvoiceReason =
  | "automatic_pending_invoice_item_invoice"
  | "manual"
  | "quote_accept"
  | "subscription"
  | "subscription_create"
  | "subscription_cycle"
  | "subscription_threshold"
  | "subscription_update"
  | "upcoming";

/**
 * Immutable financial snapshots for paid direct-Stripe subscription invoices.
 *
 * Stripe may redeliver a webhook after any downstream failure. The unique
 * invoice id makes recording idempotent while preserving the first complete
 * snapshot observed for that paid invoice. Amounts use Stripe's provider minor
 * units without recomputation or floating-point conversion.
 */
export const organizationBillingInvoiceEvents = pgTable(
  "organization_billing_invoice_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    providerEventId: text("provider_event_id"),
    invoiceId: text("invoice_id").notNull(),
    subscriptionId: text("subscription_id").notNull(),
    billingReason: text("billing_reason")
      .$type<OrganizationBillingInvoiceReason>()
      .notNull(),
    seatCount: integer("seat_count"),
    priceId: text("price_id"),
    unitAmount: bigint("unit_amount", { mode: "number" }),
    currency: text("currency").notNull(),
    interval: text("interval"),
    intervalCount: integer("interval_count"),
    totalAmount: bigint("total_amount", { mode: "number" }).notNull(),
    periodStartsAt: timestamp("period_starts_at"),
    periodEndsAt: timestamp("period_ends_at"),
    occurredAt: timestamp("occurred_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_billing_invoice_events_invoice_idx").on(
      table.invoiceId,
    ),
    index("organization_billing_invoice_events_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  ],
);
