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

/**
 * Documents a pause's cleanup removed from this device, kept while their
 * organization stays paused so reopening one, even after a restart, does not
 * recreate it locally. Resuming the organization drops its rows.
 */
export const organizationSyncPauseRemovals = sqliteTable(
  "organization_sync_pause_removals",
  {
    localId: text("local_id").primaryKey(),
    organizationId: text("organization_id").notNull(),
  },
);

export const organizationSyncPauseTables: ReadonlyArray<SqlTableSchema> = [
  defineSqlTableSchema(organizationSyncPauses),
  defineSqlTableSchema(organizationSyncPauseRemovals),
];

export const organizationSyncPauseSQLiteSchema = {
  organizationSyncPauseRemovals,
  organizationSyncPauses,
};
