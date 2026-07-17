import { sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp, uniqueIndex, uuid } from "./columns";
import type {
  OrganizationReadModelLane,
  OrganizationReadModelOperation,
} from "./shared";

/**
 * Transactional cursor heads for organization-scoped administrative data.
 *
 * Writers lock and increment one organization's row before appending a change.
 * Unlike a database sequence, the cursor increment rolls back with the source
 * mutation and its allocation order therefore matches commit order.
 */
export const organizationReadModelHeads = pgTable(
  "organization_read_model_heads",
  {
    organizationId: uuid("organization_id").primaryKey(),
    cursor: bigint("cursor", { mode: "bigint" }).default(sql`0`).notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
);

/**
 * Durable invalidations for organization-scoped administrative read models.
 *
 * Callers append only after an authoritative domain transition. Exact mutation
 * replays are filtered at that boundary; duplicate invalidations remain safe
 * because clients apply projection pages idempotently. These rows are display-
 * sync metadata only, never authorization or cryptographic keying inputs.
 */
export const organizationReadModelChanges = pgTable(
  "organization_read_model_changes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    cursor: bigint("cursor", { mode: "bigint" }).notNull(),
    lane: text("lane").$type<OrganizationReadModelLane>().notNull(),
    entityId: uuid("entity_id").notNull(),
    operation: text("operation")
      .$type<OrganizationReadModelOperation>()
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organization_read_model_changes_org_cursor_idx").on(
      table.organizationId,
      table.cursor,
    ),
  ],
);
