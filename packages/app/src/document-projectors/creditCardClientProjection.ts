import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readCreditCardFieldsFromRecord } from "../document-types/credit-card/creditCardDocumentDefinition";

const creditCardProjection = sqliteTable(
  "credit_card_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    cardLast4: text("card_last4"),
    expirationDate: text("expiration_date").notNull().default(""),
    nameOnCard: text("name_on_card").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("credit_card_projection_expiration_idx").on(table.expirationDate),
  ],
);

const CREDIT_CARD_PROJECTION_TABLE = defineSqlTableSchema(creditCardProjection);

export const creditCardClientProjection: DocumentClientProjectionDefinition = {
  tables: [CREDIT_CARD_PROJECTION_TABLE],
  async save(input) {
    const fields = readCreditCardFieldsFromRecord(
      input.structuredFields,
    ).fields;
    const digits = fields.cardNumber.replaceAll(/\D/gu, "");
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      cardLast4: digits.length >= 4 ? digits.slice(-4) : null,
      expirationDate: fields.expirationDate,
      nameOnCard: fields.nameOnCard,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(creditCardProjection)
        .values(row)
        .onConflictDoUpdate({
          target: creditCardProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(creditCardProjection)
        .where(eq(creditCardProjection.localId, input.localId))
        .run();
    });
  },
};
