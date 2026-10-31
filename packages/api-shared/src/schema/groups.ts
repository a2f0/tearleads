import { sql } from "drizzle-orm";
import { bigint, index, pgTable, timestamp, uuid } from "./columns";

/**
 * Basic group catalog rows.
 *
 * Groups are managed recipient principals. This table keeps the lightweight
 * group identity record; signed group membership, roles, and key material
 * live in `principalStates` and `principalMembershipProjection`.
 *
 * Columns:
 * - `id`: Stable group id.
 * - `organizationId`: Organization that owns the group, when the group is
 *   organization-scoped.
 * - `membershipCursor`: Organization read-model cursor of the group's last
 *   membership change; display-sync metadata only.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id"),
    membershipCursor: bigint("membership_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("groups_organization_id_idx").on(table.organizationId, table.id),
  ],
);

/** Durable authority tombstone preventing a deleted organization group from
 * being recreated as either an organization-scoped or standalone principal.
 * `deletedCursor` is the organization read-model cursor that deleted the
 * group's membership; organization purge leaves it at 0 because the purged
 * organization has no read model left to replay. */
export const organizationGroupTombstones = pgTable(
  "organization_group_tombstones",
  {
    groupId: uuid("group_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    deletedCursor: bigint("deleted_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    deletedAt: timestamp("deleted_at").defaultNow().notNull(),
  },
  (table) => [
    index("organization_group_tombstones_org_idx").on(
      table.organizationId,
      table.deletedCursor,
    ),
  ],
);
