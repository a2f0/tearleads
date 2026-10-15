import { sql } from "drizzle-orm";
import { bigint, pgTable, timestamp, uuid } from "./columns";

/**
 * Transactional cursor heads and lane stamps for organization-scoped
 * administrative read models.
 *
 * A source mutation increments `cursor` and stamps every lane it changed with
 * the new value in one update of this row. The increment rolls back with the
 * mutation and holds the row lock until commit, so allocation order matches
 * commit order. A lane changed after a client's cursor exactly when its stamp
 * is greater. Per-group membership changes are stamped on `groups` rows and
 * deletions on `organization_group_tombstones`. All stamps are display-sync
 * metadata only, never authorization or cryptographic keying inputs.
 */
export const organizationReadModelHeads = pgTable(
  "organization_read_model_heads",
  {
    organizationId: uuid("organization_id").primaryKey(),
    cursor: bigint("cursor", { mode: "bigint" }).default(sql`0`).notNull(),
    directoryCursor: bigint("directory_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    grantsCursor: bigint("grants_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    groupMembershipsCursor: bigint("group_memberships_cursor", {
      mode: "bigint",
    })
      .default(sql`0`)
      .notNull(),
    groupsCursor: bigint("groups_cursor", { mode: "bigint" })
      .default(sql`0`)
      .notNull(),
    organizationPolicyCursor: bigint("organization_policy_cursor", {
      mode: "bigint",
    })
      .default(sql`0`)
      .notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);
