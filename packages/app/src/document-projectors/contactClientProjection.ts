import type { DocumentClientProjectionDefinition } from "@symcrypt/client-sdk";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readContactFieldsFromRecord } from "../document-types/contact/contactDocumentDefinition";
import {
  isTruthyStructuredField,
  nullableField,
} from "../document-types/shared/documentFieldUtils";
import { createDocumentSqlProjection } from "./createDocumentSqlProjection";

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

export const contactClientProjection: DocumentClientProjectionDefinition =
  createDocumentSqlProjection(contactProjection, (input) => {
    const fields = readContactFieldsFromRecord(input.structuredFields).fields;
    return {
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
  });
