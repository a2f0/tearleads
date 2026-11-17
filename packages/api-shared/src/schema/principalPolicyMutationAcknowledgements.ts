import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Immutable compound container acknowledgements retained for exact retries. */
export const principalPolicyMutationAcknowledgements = pgTable(
  "principal_policy_mutation_acknowledgements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalType: text("principal_type")
      .$type<ManagedRecipientPrincipalType>()
      .notNull(),
    principalId: uuid("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    batchIndex: integer("batch_index").notNull(),
    containerId: uuid("container_id").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    /**
     * Domain-separated SHA-256 of the request's canonical JSON: the stored
     * commitment an exact replay must match, without keeping the request.
     */
    requestSha256: text("request_sha256").notNull(),
    responseJson: text("response_json").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("principal_policy_mutation_acks_batch_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.batchIndex,
    ),
    // Leads with the container so an organization purge deletes by
    // container through it; reads by principal and state use the batch index.
    uniqueIndex("principal_policy_mutation_acks_container_idx").on(
      table.containerId,
      table.principalType,
      table.principalId,
      table.stateHash,
    ),
  ],
);
