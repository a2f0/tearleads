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
 * - `entitlementId`: Provider entitlement granting sync for this organization.
 * - `currentPeriodEndsAt`: End of the paid period reported by the provider; sync
 *   lapses if it passes without renewal.
 * - `seatCount`: Reserved for per-seat pricing. Unused while pricing is flat.
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
    entitlementId: text("entitlement_id"),
    currentPeriodEndsAt: timestamp("current_period_ends_at"),
    seatCount: integer("seat_count"),
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
  ],
);
