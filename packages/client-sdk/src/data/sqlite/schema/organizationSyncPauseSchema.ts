import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Organizations whose content this user has paused syncing to their devices.
 *
 * A device-local copy of the user's own choice, which the server keeps on their
 * roster entry and sends with their membership list, so a device that starts
 * offline still honors it. It is never an access or keying input: a paused
 * organization keeps its grants and keys, and only its metadata root stays on
 * the device.
 */
export const organizationSyncPauses = sqliteTable("organization_sync_pauses", {
  organizationId: text("organization_id").primaryKey(),
});

export const organizationSyncPauseTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationSyncPauses),
];

export const organizationSyncPauseSQLiteSchema = { organizationSyncPauses };
