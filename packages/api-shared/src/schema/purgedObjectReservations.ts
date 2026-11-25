import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export type PurgedObjectKind = "container" | "document";

/**
 * Container and document ids an organization billing purge freed, each held
 * for the one user who may recover that organization.
 *
 * Recovery recreates the purged personal organization's folders and documents
 * under their old ids, so the purge records every id it frees in the same
 * transaction that deletes its rows, naming the user whose default
 * organization was purged: the only user `assertReplacementReady` lets replace
 * it. Every create path refuses a reserved id to any other user, so nobody who
 * learned an id from history can take it before the owner's devices recreate
 * it. The owner's successful create deletes the row in its own transaction;
 * from then on the id's head refuses other creates. A purge of the replacement
 * reserves the id again. A shared organization has no owner who can recover it,
 * so its purge reserves nothing.
 *
 * Rows never expire: an owner device that comes back late must still be able
 * to recreate what it holds. They are bounded by the owner's own unrecovered
 * folders and documents, and go with the owner's user row.
 */
export const purgedObjectReservations = pgTable(
  "purged_object_reservations",
  {
    objectKind: text("object_kind").$type<PurgedObjectKind>().notNull(),
    objectId: uuid("object_id").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purgedOrganizationId: uuid("purged_organization_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "purged_object_reservations_pkey",
      columns: [table.objectKind, table.objectId],
    }),
    index("purged_object_reservations_owner_idx").on(table.ownerUserId),
  ],
);
