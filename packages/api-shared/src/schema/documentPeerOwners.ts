import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The user that owns each Loro peer of a document.
 *
 * A peer's committed frontier is the highest `end_counter` (exclusive) of its
 * `document_update_spans` rows. Under the document head lock, a write may
 * re-assert any peer's counters below that frontier, but only the peer's owner
 * may extend it. The first write that extends a peer with no owner claims it
 * for its writer's user, so another user's extension is refused (409
 * `document_sync_peer_owned`) and its request rolls back. Owner is the user,
 * not a device or key, so every device of one user may write under the peer.
 * The migration that added this table gave a peer whose first author named
 * no user the nil id, which no user has, so nobody may extend that peer.
 *
 * Like the span rows, these rows carry no foreign keys; a document purge
 * deletes both.
 */
export const documentPeerOwners = pgTable(
  "document_peer_owners",
  {
    documentId: uuid("document_id").notNull(),
    peerId: text("peer_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "document_peer_owners_pkey",
      columns: [table.documentId, table.peerId],
    }),
  ],
);
