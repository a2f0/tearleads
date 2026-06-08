import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { OrganizationRosterStatus } from "./shared";

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
export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  adminGroupId: uuid("admin_group_id").notNull(),
  memberGroupId: uuid("member_group_id").notNull(),
  name: text("name").notNull(),
  profileDocumentId: uuid("profile_document_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
