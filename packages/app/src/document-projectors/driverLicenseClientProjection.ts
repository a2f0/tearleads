import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readDriverLicenseFieldsFromRecord } from "../document-types/drivers-license/driverLicenseDocumentDefinition";
import { createDocumentSqlProjection } from "./createDocumentSqlProjection";

const driverLicenseProjection = sqliteTable(
  "driver_license_projection",
  {
    localId: text("local_id").primaryKey(),
    documentId: text("document_id"),
    containerId: text("container_id"),
    licenseId: text("license_id").notNull().default(""),
    expirationDate: text("expiration_date").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("driver_license_projection_expiration_idx").on(table.expirationDate),
  ],
);

export const driverLicenseClientProjection: DocumentClientProjectionDefinition =
  createDocumentSqlProjection(driverLicenseProjection, (input) => {
    const fields = readDriverLicenseFieldsFromRecord(
      input.structuredFields,
    ).fields;
    return {
      localId: input.localId,
      documentId: input.documentId,
      containerId: input.containerId,
      licenseId: fields.licenseId,
      expirationDate: fields.expirationDate,
      updatedAt: input.updatedAt,
    };
  });
