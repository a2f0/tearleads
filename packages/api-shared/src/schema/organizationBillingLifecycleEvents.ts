import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

export type OrganizationBillingLifecycleEventType =
  | "free_trial_initialized"
  | "free_trial_expired";

/**
 * Immutable snapshots of billing transitions owned by Tearleads itself.
 *
 * Provider lifecycle events remain in their provider audit ledgers. This table
 * records product lifecycle that has no payment-provider event, currently the
 * inception and expiration of an organization's free trial. The seat fields
 * capture the licensed-capacity effect at that instant; the period fields keep
 * the original trial interval available after current billing state changes.
 */
export const organizationBillingLifecycleEvents = pgTable(
  "organization_billing_lifecycle_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    eventType: text("event_type")
      .$type<OrganizationBillingLifecycleEventType>()
      .notNull(),
    sourceId: text("source_id").notNull(),
    licensedSeatCount: integer("licensed_seat_count").notNull(),
    quantityDelta: integer("quantity_delta").notNull(),
    activeSeatCount: integer("active_seat_count").notNull(),
    periodStartsAt: timestamp("period_starts_at").notNull(),
    periodEndsAt: timestamp("period_ends_at").notNull(),
    occurredAt: timestamp("occurred_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_billing_lifecycle_events_source_idx").on(
      table.organizationId,
      table.eventType,
      table.sourceId,
    ),
    index("organization_billing_lifecycle_events_org_occurred_idx").on(
      table.organizationId,
      table.occurredAt,
    ),
  ],
);
