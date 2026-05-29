import type { DocumentClientProjectionDefinition } from "@tearleads/client-sdk";
import {
  defineSqlTableSchema,
  getSQLitePersistenceRuntime,
} from "@tearleads/client-sdk/sqlite";
import { eq } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { readDriverLicenseFieldsFromRecord } from "../document-types/drivers-license/driverLicenseDocumentDefinition";

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

const DRIVER_LICENSE_PROJECTION_TABLE = defineSqlTableSchema(
  driverLicenseProjection,
);

export const driverLicenseClientProjection: DocumentClientProjectionDefinition =
  {
    tables: [DRIVER_LICENSE_PROJECTION_TABLE],
    async save(input) {
      const fields = readDriverLicenseFieldsFromRecord(
        input.structuredFields,
      ).fields;
      const row = {
        localId: input.localId,
        documentId: input.documentId,
        containerId: input.containerId,
        licenseId: fields.licenseId,
        expirationDate: fields.expirationDate,
        updatedAt: input.updatedAt,
      };

      await getSQLitePersistenceRuntime(input.execSql).runMutation(
        async (db) => {
          await db
            .insert(driverLicenseProjection)
            .values(row)
            .onConflictDoUpdate({
              target: driverLicenseProjection.localId,
              set: row,
            })
            .run();
        },
      );
    },
    async delete(input) {
      await getSQLitePersistenceRuntime(input.execSql).runMutation(
        async (db) => {
          await db
            .delete(driverLicenseProjection)
            .where(eq(driverLicenseProjection.localId, input.localId))
            .run();
        },
      );
    },
  };
