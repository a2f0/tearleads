import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { defineSqlTableSchema, type SqlTableSchema } from "../sqlTableSchema";

/**
 * Organizations whose content sync this user has paused on this device.
 *
 * The device's own record of the user's choice, which the server also keeps on
 * their roster entry and sends with their membership list, so a device that
 * starts offline still honors it. It is never an access or keying input: a
 * paused organization keeps its grants, keys, and local copy; the device only
 * stops sending and fetching its content until the user resumes.
 */
export const organizationSyncPauses = sqliteTable("organization_sync_pauses", {
  organizationId: text("organization_id").primaryKey(),
});

export const organizationSyncPauseTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationSyncPauses),
];

export const organizationSyncPauseSQLiteSchema = {
  organizationSyncPauses,
};
