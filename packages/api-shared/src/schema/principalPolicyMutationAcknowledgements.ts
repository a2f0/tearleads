import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "./columns";

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
    requestJson: text("request_json").notNull(),
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
    uniqueIndex("principal_policy_mutation_acks_container_idx").on(
      table.principalType,
      table.principalId,
      table.stateHash,
      table.containerId,
    ),
  ],
);
