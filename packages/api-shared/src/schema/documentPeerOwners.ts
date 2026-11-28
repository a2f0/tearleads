import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * The user that owns each Loro peer of a document.
 *
 * A peer's committed frontier is the highest `end_counter` (exclusive) of its
 * `document_update_spans` rows. Under the document head lock, a write may
 * re-assert any peer's counters below that frontier, but only the peer's owner
 * may extend it — with one narrow post-purge restoration exception: when an
 * organization billing purge freed the document and its owner recreated it,
 * the pre-purge peer owners are restored here with `restorable_end_counter`
 * set to their pre-purge frontier and `recovery_owner_user_id` set to the
 * recovering owner. Up to `restorable_end_counter`, the recovery owner (and,
 * when `allow_member_restore` is explicitly enabled by that owner, any
 * authorized writer) may replay lost operations without transferring
 * `owner_user_id` away from the peer's rightful owner.
 *
 * Like the span rows, these rows carry no foreign keys; a document purge
 * deletes both (after snapshotting personal-organization peers into
 * `purged_document_peer_owners`).
 */
export const documentPeerOwners = pgTable(
  "document_peer_owners",
  {
    documentId: uuid("document_id").notNull(),
    peerId: text("peer_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    restorableEndCounter: integer("restorable_end_counter")
      .default(0)
      .notNull(),
    recoveryOwnerUserId: uuid("recovery_owner_user_id"),
    allowMemberRestore: boolean("allow_member_restore")
      .default(false)
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "document_peer_owners_pkey",
      columns: [table.documentId, table.peerId],
    }),
  ],
);

/**
 * Pre-purge peer owners snapshotted during an organization billing purge so
 * recreating the document restores rightful ownership and a bounded restorable
 * frontier window (#3263). Rows are consumed when the owner recreates the
 * document and cascade if the owner user is deleted.
 */
export const purgedDocumentPeerOwners = pgTable(
  "purged_document_peer_owners",
  {
    documentId: uuid("document_id").notNull(),
    peerId: text("peer_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    purgedEndCounter: integer("purged_end_counter").notNull(),
    recoveryOwnerUserId: uuid("recovery_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "purged_document_peer_owners_pkey",
      columns: [table.documentId, table.peerId],
    }),
    index("purged_document_peer_owners_recovery_owner_idx").on(
      table.recoveryOwnerUserId,
    ),
  ],
);
