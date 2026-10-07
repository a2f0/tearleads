import { bigint, index, pgTable, text, uniqueIndex, uuid } from "./columns";

/** First signed directory citation of each group head, retained after group deletion. */
export const principalDirectoryBindings = pgTable(
  "principal_directory_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    organizationVersion: bigint("organization_version", {
      mode: "number",
    }).notNull(),
    organizationStateHash: text("organization_state_hash").notNull(),
    groupId: uuid("group_id").notNull(),
    groupVersion: bigint("group_version", { mode: "number" }).notNull(),
    groupStateHash: text("group_state_hash").notNull(),
  },
  (table) => [
    uniqueIndex("principal_directory_bindings_head_idx").on(
      table.organizationId,
      table.groupId,
      table.groupStateHash,
    ),
    index("principal_directory_bindings_lookup_idx").on(
      table.organizationId,
      table.groupId,
      table.organizationVersion,
    ),
  ],
);
