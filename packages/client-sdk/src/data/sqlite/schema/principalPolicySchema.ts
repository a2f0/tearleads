import { desc, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { principalStateFingerprintJson } from "../principalKeyFingerprintJson";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";
import { principalHistoryEvidenceTables } from "./principalHistoryEvidenceSchema";
import { principalHistoryStageTables } from "./principalHistoryStageSchema";

/**
 * Every verified policy bundle kept per managed principal: the one current
 * head, and older bundles retained for exact-reference verification and epoch
 * key unwrapping. Promotion flips `isCurrent` instead of copying bundles.
 */
export const principalPolicyBundles = sqliteTable(
  "principal_policy_bundles",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull(),
    identityBundleFormat: integer("identity_bundle_format")
      .notNull()
      .default(1),
    currentStateJson: text("current_state_json").notNull(),
    currentPayloadJson: text("current_payload_json").notNull(),
    currentProjectionJson: text("current_projection_json").notNull(),
    currentGrantsJson: text("current_grants_json").notNull(),
    currentMemberEnvelopesJson: text("current_member_envelopes_json").notNull(),
    previousStatesJson: text("previous_states_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.principalType, table.principalId, table.stateHash],
    }),
    uniqueIndex("principal_policy_bundles_current_idx")
      .on(table.principalType, table.principalId)
      .where(sql`${table.isCurrent} = 1`),
    index("principal_policy_bundles_key_fingerprint_idx").on(
      principalStateFingerprintJson(table.currentStateJson),
      table.isCurrent,
      desc(table.updatedAt),
    ),
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

/**
 * Durable organization ownership for every managed-principal cache, and its
 * monotonic anti-rollback pin. Policy caching records the owner before any
 * pin, so a row with a null version, state hash, and update time is owned but
 * not pinned; the pin readers treat it as no checkpoint.
 */
export const principalPolicyCheckpoints = sqliteTable(
  "principal_policy_checkpoints",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    organizationId: text("organization_id").notNull(),
    version: integer("version"),
    stateHash: text("state_hash"),
    updatedAt: text("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
  ],
);

export const principalPolicyCheckpointTable = {
  ...defineSqlTableSchema(principalPolicyCheckpoints),
  requiredColumns: ["organization_id"],
};

export const principalPolicyTables: ReadonlyArray<SqlTableSchema> = [
  {
    ...defineSqlTableSchema(principalPolicyBundles),
    requiredColumns: ["identity_bundle_format"],
  },
  defineSqlTableSchema(principalPolicyBundleReferences),
  principalPolicyCheckpointTable,
  ...principalHistoryStageTables,
  ...principalHistoryEvidenceTables,
];
