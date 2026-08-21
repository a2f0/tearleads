import type { DocumentClientProjectionDefinition } from "@symcrypt/client-sdk";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readPassportFieldsFromRecord } from "../document-types/passport/passportDocumentDefinition";
import { createDocumentSqlProjection } from "./createDocumentSqlProjection";

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

export const passportClientProjection: DocumentClientProjectionDefinition =
  createDocumentSqlProjection(passportProjection, (input) => {
    const fields = readPassportFieldsFromRecord(input.structuredFields).fields;
    return {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      passportNumber: fields.passportNumber,
      fullName: fields.fullName,
      issuingCountry: fields.issuingCountry,
      expirationDate: fields.expirationDate,
      updatedAt: input.updatedAt,
    };
  });
