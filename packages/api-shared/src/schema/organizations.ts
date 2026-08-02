import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";
import type {
  OrganizationBillingProvider,
  OrganizationBillingSeatEventSourceType,
  OrganizationBillingSeatEventType,
  OrganizationBillingStatus,
  OrganizationRosterStatus,
} from "./shared";

/**
 * Organization catalog rows.
 *
 * Organizations define the top-level ownership boundary for containers,
 * documents, manifests, and keying state. Registration creates a personal
 * organization named `Personal`; the signed principal-state tables carry the
 * organization's access policy and recipient key history.
 *
 * Columns:
 * - `id`: Stable organization id. Container and access-manifest rows copy this
 *   id as their organization boundary.
 * - `adminGroupId`: Reserved organization-scoped group whose reachable members
 *   have organization-admin authority.
 * - `memberGroupId`: Reserved organization-scoped group whose reachable
 *   members belong to the organization.
 * - `name`: Human-readable organization name.
 * - `profileDocumentId`: Optional encrypted document containing org-scoped
 *   profile fields such as customizable display name.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminGroupId: uuid("admin_group_id").notNull(),
    memberGroupId: uuid("member_group_id").notNull(),
    name: text("name").notNull(),
    profileDocumentId: uuid("profile_document_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organizations_profile_document_idx").on(table.profileDocumentId),
  ],
);

/**
 * Organization roster lifecycle and encrypted profile binding rows.
 *
 * This table is product state, not access authority. Signed groups and
 * container grants decide access. Roster rows let org-manager keep showing
 * disabled/departed accounts and bind private profile fields to encrypted Loro
 * documents without exposing names, email addresses, titles, or notes to the
 * server.
 *
 * Columns:
 * - `organizationId`: Organization that owns the roster entry.
 * - `userId`: Global user identity represented by this roster entry.
 * - `status`: Lifecycle state. Disabled users may remain visible in the
 *   directory even after they are removed from access groups.
 * - `profileDocumentId`: Optional encrypted document containing org-scoped
 *   profile/contact fields such as first name, last name, email, and title.
 * - `joinedAt`: When the user first became visible in this organization
 *   roster.
 * - `disabledAt` / `disabledByUserId`: Deactivation audit metadata.
 * - `createdAt` / `updatedAt`: Server-side row timestamps.
 */
export const organizationRosterEntries = pgTable(
  "organization_roster_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    status: text("status")
      .$type<OrganizationRosterStatus>()
      .default("active")
      .notNull(),
    profileDocumentId: uuid("profile_document_id"),
    joinedAt: timestamp("joined_at").defaultNow().notNull(),
    disabledAt: timestamp("disabled_at"),
    disabledByUserId: uuid("disabled_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_roster_entries_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
    index("organization_roster_entries_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    index("organization_roster_entries_profile_document_idx").on(
      table.profileDocumentId,
    ),
  ],
);

/**
 * Per-organization sync billing state.
 *
 * Sync is the single paid feature: an organization's containers, documents, and
 * blobs sync to the server only while its billing can sync. The product is free
 * to use fully locally, so every organization owns exactly one billing row and it
 * starts `local` (on-device only, no server sync). Enabling sync starts a trial,
 * and a paid subscription keeps it active. This is uniform for every organization
 * — the personal organization created at registration is just an organization
 * that has not started a subscription.
 *
 * Access authority is unchanged: signed groups and container grants still decide
 * who can touch what. This row only decides whether the owning organization may
 * sync at all.
 *
 * Columns:
 * - `organizationId`: Organization this billing row belongs to (one per org).
 * - `status`: Sync-billing lifecycle. `local` (free, on-device only), `trialing`
 *   and `active` can sync; `past_due`, `disabled`, `deleting`, `purged` cannot.
 * - `trialEndsAt`: When the free trial ends. Null unless `status` is `trialing`.
 * - `provider`: Payment provider backing an `active` subscription (RevenueCat).
 *   Null while `local`/`trialing`.
 * - `providerCustomerId`: Provider-side customer id (RevenueCat App User ID) that
 *   purchased the subscription.
 * - `providerSubscriptionId`: Provider-side stable subscription/original
 *   transaction id, when the provider reports one.
 * - `providerProductId` / `providerTransactionId`: Latest provider product and
 *   transaction ids applied to this billing row.
 * - `entitlementId`: Provider entitlement granting sync for this organization.
 * - `currentPeriodStartsAt`: Start of the paid period reported by the provider.
 * - `currentPeriodEndsAt`: End of the paid period reported by the provider; sync
 *   lapses if it passes without renewal.
 * - `seatCount`: Licensed seats for the current paid billing period. Seat
 *   switches are reconciled by `organization_billing_seat_assignments`.
 * - `seatPeriodKey`: Explicit identity of the trial/paid period represented by
 *   `seatCount`. This cannot be inferred from open assignments because an
 *   organization can legitimately have none at period rollover.
 * - `checkoutAttempt*`: Durable, organization-scoped ownership of an unpaid
 *   Stripe checkout. Inline and hosted checkout share this guard so they
 *   cannot race into two subscriptions. The captured seat quantity remains
 *   fixed for an idempotent retry and the token rotates after expiry.
 * - `disabledAt` / `purgeAfter`: Set when sync lapses. The purge job may delete
 *   the organization's remote sync data after `purgeAfter`.
 * - `purgeStartedAt` / `purgedAt`: Purge job progress markers.
 * - `createdAt` / `updatedAt`: Server-side row timestamps.
 */
export const organizationBilling = pgTable(
  "organization_billing",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    status: text("status")
      .$type<OrganizationBillingStatus>()
      .default("local")
      .notNull(),
    trialEndsAt: timestamp("trial_ends_at"),
    provider: text("provider").$type<OrganizationBillingProvider>(),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerProductId: text("provider_product_id"),
    providerTransactionId: text("provider_transaction_id"),
    entitlementId: text("entitlement_id"),
    currentPeriodStartsAt: timestamp("current_period_starts_at"),
    currentPeriodEndsAt: timestamp("current_period_ends_at"),
    seatCount: integer("seat_count").default(0).notNull(),
    seatPeriodKey: text("seat_period_key"),
    checkoutAttemptId: text("checkout_attempt_id"),
    checkoutAttemptMode: text("checkout_attempt_mode").$type<
      "inline" | "hosted"
    >(),
    checkoutAttemptUserId: uuid("checkout_attempt_user_id"),
    checkoutAttemptSeatQuantity: integer("checkout_attempt_seat_quantity"),
    checkoutAttemptStartedAt: timestamp("checkout_attempt_started_at"),
    checkoutAttemptExpiresAt: timestamp("checkout_attempt_expires_at"),
    disabledAt: timestamp("disabled_at"),
    purgeAfter: timestamp("purge_after"),
    purgeStartedAt: timestamp("purge_started_at"),
    purgedAt: timestamp("purged_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_billing_org_idx").on(table.organizationId),
    index("organization_billing_trial_expiry_idx").on(
      table.status,
      table.trialEndsAt,
      table.organizationId,
    ),
    index("organization_billing_purge_candidates_idx").on(
      table.status,
      table.purgeAfter,
      table.purgeStartedAt,
      table.organizationId,
    ),
    // Greenfield invariant: one store subscription funds one organization.
    // Prelaunch databases with conflicting fixtures are reset, not backfilled.
    uniqueIndex("organization_billing_provider_subscription_idx").on(
      table.providerSubscriptionId,
    ),
  ],
);

/**
 * Durable Stripe binding and coalescing seat-sync outbox for one organization.
 *
 * `desiredPaidCapacity` is the current period's licensed high-water mark;
 * `desiredRenewalQuantity` is the active roster quantity Stripe should carry
 * into the next invoice. An in-flight capacity target is sticky across retries
 * so the same Stripe idempotency key is replayed after a crash.
 */
export const organizationBillingStripeSeats = pgTable(
  "organization_billing_stripe_seats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    customerId: text("customer_id"),
    subscriptionId: text("subscription_id"),
    subscriptionItemId: text("subscription_item_id"),
    priceId: text("price_id"),
    desiredPaidCapacity: integer("desired_paid_capacity").default(0).notNull(),
    desiredRenewalQuantity: integer("desired_renewal_quantity")
      .default(0)
      .notNull(),
    appliedPaidCapacity: integer("applied_paid_capacity").default(0).notNull(),
    observedQuantity: integer("observed_quantity"),
    desiredSeatPeriodKey: text("desired_seat_period_key"),
    appliedSeatPeriodKey: text("applied_seat_period_key"),
    billingPeriodStartsAt: timestamp("billing_period_starts_at"),
    billingPeriodEndsAt: timestamp("billing_period_ends_at"),
    desiredRevision: integer("desired_revision").default(0).notNull(),
    appliedRevision: integer("applied_revision").default(0).notNull(),
    inFlightOperationId: text("in_flight_operation_id"),
    inFlightTargetCapacity: integer("in_flight_target_capacity"),
    nextAttemptAt: timestamp("next_attempt_at"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseId: text("lease_id"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at"),
    lastInvoiceId: text("last_invoice_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_billing_stripe_seats_org_idx").on(
      table.organizationId,
    ),
    uniqueIndex("organization_billing_stripe_seats_subscription_idx").on(
      table.subscriptionId,
    ),
    uniqueIndex("organization_billing_stripe_seats_item_idx").on(
      table.subscriptionItemId,
    ),
    index("organization_billing_stripe_seats_due_idx").on(
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.organizationId,
    ),
  ],
);

/**
 * Current and historical billable-seat assignments for an organization.
 *
 * A row represents one user occupying one licensed seat during one billing
 * period. Releasing a user frees that seat for reuse during the same period;
 * adding more simultaneously-active users than the licensed seat count creates
 * an accounting event that can be pushed to the billing provider.
 */
export const organizationBillingSeatAssignments = pgTable(
  "organization_billing_seat_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    billingPeriodStartsAt: timestamp("billing_period_starts_at"),
    billingPeriodEndsAt: timestamp("billing_period_ends_at"),
    assignedAt: timestamp("assigned_at").notNull(),
    releasedAt: timestamp("released_at"),
    assignmentSourceType: text("assignment_source_type")
      .$type<OrganizationBillingSeatEventSourceType>()
      .notNull(),
    assignmentSourceId: text("assignment_source_id").notNull(),
    releaseSourceType: text(
      "release_source_type",
    ).$type<OrganizationBillingSeatEventSourceType>(),
    releaseSourceId: text("release_source_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_billing_seat_assignments_org_open_idx").on(
      table.organizationId,
      table.releasedAt,
    ),
    index("organization_billing_seat_assignments_org_user_idx").on(
      table.organizationId,
      table.userId,
      table.releasedAt,
    ),
    index("organization_billing_seat_assignments_org_period_idx").on(
      table.organizationId,
      table.billingPeriodStartsAt,
      table.billingPeriodEndsAt,
    ),
  ],
);

/**
 * Audit ledger for billable-seat reconciliation.
 *
 * Events are intentionally provider-neutral. They capture the seat movement and
 * current licensed count that a Stripe or RevenueCat integration can use to
 * update subscription quantity or create a prorated charge for the remaining
 * billing period.
 */
export const organizationBillingSeatEvents = pgTable(
  "organization_billing_seat_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    eventType: text("event_type")
      .$type<OrganizationBillingSeatEventType>()
      .notNull(),
    userId: uuid("user_id"),
    quantityDelta: integer("quantity_delta").notNull(),
    licensedSeatCount: integer("licensed_seat_count").notNull(),
    activeSeatCount: integer("active_seat_count").notNull(),
    billingPeriodStartsAt: timestamp("billing_period_starts_at"),
    billingPeriodEndsAt: timestamp("billing_period_ends_at"),
    sourceType: text("source_type")
      .$type<OrganizationBillingSeatEventSourceType>()
      .notNull(),
    sourceId: text("source_id").notNull(),
    sourcePrincipalType: text("source_principal_type"),
    sourcePrincipalId: uuid("source_principal_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_billing_seat_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("organization_billing_seat_events_org_source_idx").on(
      table.organizationId,
      table.sourceType,
      table.sourceId,
    ),
    index("organization_billing_seat_events_org_period_idx").on(
      table.organizationId,
      table.billingPeriodStartsAt,
      table.billingPeriodEndsAt,
    ),
  ],
);
