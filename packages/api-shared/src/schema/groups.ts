import { index, pgTable, text, timestamp, uuid } from "./columns";

/**
 * Basic group catalog rows.
 *
 * Groups are managed recipient principals. This table keeps the lightweight
 * group identity/name record; signed group membership, roles, and key material
 * live in `principalStates`, `principalMembershipProjection`, and
 * `principalEpochKeys`.
 *
 * Columns:
 * - `id`: Stable group id.
 * - `organizationId`: Organization that owns the group, when the group is
 *   organization-scoped.
 * - `name`: Human-readable group name.
 * - `createdAt`: Server-side insertion timestamp.
 */
export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id"),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("groups_organization_name_idx").on(
      table.organizationId,
      table.name,
      table.id,
    ),
  ],
);
