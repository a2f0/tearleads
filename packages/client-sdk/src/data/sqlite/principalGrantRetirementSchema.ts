import { primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

// A local expectation acknowledged with a policy rotation, not a signed
// deletion proof. Historical evidence is retained; current resurrection fails.
export const principalGrantRetirements = sqliteTable(
  "principal_grant_retirements",
  {
    organizationId: text("organization_id").notNull(),
    containerId: text("container_id").notNull(),
    principalId: text("principal_id").notNull(),
    policyStateHash: text("policy_state_hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.containerId] }),
  ],
);
