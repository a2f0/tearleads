import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

export type PrincipalHistoryVerificationKind = "policy" | "authority";

/**
 * Locally authenticated verification hints, never principal authority by
 * themselves. Only the server's private progress key can validate the sealed
 * prefix; the plain columns merely locate candidates. Losing these rows costs
 * bounded re-verification and must not require a principal repair write.
 */
export const principalHistoryProgress = pgTable(
  "principal_history_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
    verificationKind: text("verification_kind")
      .$type<PrincipalHistoryVerificationKind>()
      .notNull(),
    protectionId: text("protection_id").notNull(),
    inputHash: text("input_hash").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    stateHash: text("state_hash").notNull(),
    keyEpoch: integer("key_epoch").notNull(),
    keyFingerprint: text("key_fingerprint").notNull(),
    progress: text("progress").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    check(
      "principal_history_progress_version_range",
      sql`${table.version} >= 1 AND ${table.version} <= 9007199254740991`,
    ),
    check(
      "principal_history_progress_kind",
      sql`${table.verificationKind} IN ('policy', 'authority')`,
    ),
    uniqueIndex("principal_history_progress_version_idx").on(
      table.principalType,
      table.principalId,
      table.verificationKind,
      table.inputHash,
      table.version,
    ),
    index("principal_history_progress_lookup_idx").on(
      table.principalType,
      table.principalId,
      table.verificationKind,
      table.inputHash,
      table.protectionId,
      table.version,
    ),
  ],
);
