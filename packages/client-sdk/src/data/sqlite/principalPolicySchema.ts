import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

function principalPolicyBundleColumns() {
  return {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    currentStateJson: text("current_state_json").notNull(),
    currentPayloadJson: text("current_payload_json").notNull(),
    currentProjectionJson: text("current_projection_json").notNull(),
    currentMemberEnvelopesJson: text("current_member_envelopes_json").notNull(),
    previousStatesJson: text("previous_states_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  };
}

/** Latest full policy bundle per managed principal. */
export const principalPolicies = sqliteTable(
  "principal_policies",
  principalPolicyBundleColumns(),
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
  ],
);

/** Older verified bundles retained only for epoch-specific key unwrapping. */
export const principalPolicyBundleHistory = sqliteTable(
  "principal_policy_bundle_history",
  principalPolicyBundleColumns(),
  (table) => [
    primaryKey({
      columns: [table.principalType, table.principalId, table.stateHash],
    }),
  ],
);

/** Monotonic anti-rollback pin for each verified managed principal. */
export const principalPolicyCheckpoints = sqliteTable(
  "principal_policy_checkpoints",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    version: integer("version").notNull(),
    stateHash: text("state_hash").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
  ],
);
