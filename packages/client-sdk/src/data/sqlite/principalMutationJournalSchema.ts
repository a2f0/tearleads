import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema } from "./sqlTableSchema";

/** Authored work survives cache resets and remains until its outcome is known. */
export const principalMutationJournal = sqliteTable(
  "principal_mutation_journal",
  {
    scopeId: text("scope_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    serializedRequest: text("serialized_request").notNull(),
    signature: text("signature").notNull(),
  },
);

export const principalMutationJournalTables = [
  defineSqlTableSchema(principalMutationJournal),
];
