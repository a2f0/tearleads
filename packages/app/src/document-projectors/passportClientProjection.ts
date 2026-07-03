import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readPassportFieldsFromRecord } from "../document-types/passport/passportDocumentDefinition";

const passportProjection = sqliteTable(
  "passport_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    passportNumber: text("passport_number").notNull().default(""),
    fullName: text("full_name").notNull().default(""),
    issuingCountry: text("issuing_country").notNull().default(""),
    expirationDate: text("expiration_date").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("passport_projection_expiration_idx").on(table.expirationDate),
  ],
);

const PASSPORT_PROJECTION_TABLE = defineSqlTableSchema(passportProjection);

export const passportClientProjection: DocumentClientProjectionDefinition = {
  tables: [PASSPORT_PROJECTION_TABLE],
  async save(input) {
    const fields = readPassportFieldsFromRecord(input.structuredFields).fields;
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      passportNumber: fields.passportNumber,
      fullName: fields.fullName,
      issuingCountry: fields.issuingCountry,
      expirationDate: fields.expirationDate,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(passportProjection)
        .values(row)
        .onConflictDoUpdate({
          target: passportProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(passportProjection)
        .where(eq(passportProjection.localId, input.localId))
        .run();
    });
  },
};
