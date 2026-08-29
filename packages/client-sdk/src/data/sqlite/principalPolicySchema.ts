import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Durable organization ownership for every managed-principal cache. */
export const principalPolicyOrganizations = sqliteTable(
  "principal_policy_organizations",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    organizationId: text("organization_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
    index("principal_policy_organizations_organization_idx").on(
      table.organizationId,
    ),
  ],
);

function principalPolicyBundleColumns() {
  return {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    currentStateJson: text("current_state_json").notNull(),
    currentPayloadJson: text("current_payload_json").notNull(),
    currentProjectionJson: text("current_projection_json").notNull(),
    currentGrantsJson: text("current_grants_json").notNull(),
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

/** Older verified bundles retained for exact-reference verification and epoch key unwrapping. */
export const principalPolicyBundleHistory = sqliteTable(
  "principal_policy_bundle_history",
  principalPolicyBundleColumns(),
  (table) => [
    primaryKey({
      columns: [table.principalType, table.principalId, table.stateHash],
    }),
  ],
);

/** Exact policy states mapped to every retained bundle chain that contains them. */
export const principalPolicyBundleReferences = sqliteTable(
  "principal_policy_bundle_references",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    version: integer("version").notNull(),
    stateHash: text("state_hash").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    bundleVersion: integer("bundle_version").notNull(),
    bundleStateHash: text("bundle_state_hash").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.principalType,
        table.principalId,
        table.version,
        table.stateHash,
        table.keyEpoch,
        table.keyFingerprint,
        table.bundleStateHash,
      ],
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
