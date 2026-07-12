import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readContactFieldsFromRecord } from "../document-types/contact/contactDocumentDefinition";
import {
  isTruthyStructuredField,
  nullableField,
} from "../document-types/shared/documentFieldUtils";

export const contactProjection = sqliteTable(
  "contact_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    firstName: text("first_name").notNull().default(""),
    lastName: text("last_name").notNull().default(""),
    nickname: text("nickname").notNull().default(""),
    userId: text("user_id"),
    encapsulationPublicKey: text("encapsulation_public_key"),
    isSelf: integer("is_self").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("contact_projection_container_idx").on(table.containerId)],
);

const CONTACT_PROJECTION_TABLE = defineSqlTableSchema(contactProjection);

export const contactClientProjection: DocumentClientProjectionDefinition = {
  tables: [CONTACT_PROJECTION_TABLE],
  async save(input) {
    const fields = readContactFieldsFromRecord(input.structuredFields).fields;
    const row = {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      firstName: fields.firstName,
      lastName: fields.lastName,
      nickname: fields.nickname,
      userId: nullableField(fields.userId),
      encapsulationPublicKey: nullableField(fields.encapsulationPublicKey),
      isSelf: isTruthyStructuredField(fields.isSelf) ? 1 : 0,
      updatedAt: input.updatedAt,
    };

    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .insert(contactProjection)
        .values(row)
        .onConflictDoUpdate({
          target: contactProjection.localId,
          set: row,
        })
        .run();
    });
  },
  async delete(input) {
    await getSQLitePersistenceRuntime(input.execSql).runMutation(async (db) => {
      await db
        .delete(contactProjection)
        .where(eq(contactProjection.localId, input.localId))
        .run();
    });
  },
};
