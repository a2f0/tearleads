import { pgTable, text } from "./columns";

/** Untrusted proof material; only a locally verified root grants authority. */
export const principalHistoryIndexNodes = pgTable(
  "principal_history_index_nodes",
  {
    hash: text("hash").primaryKey(),
    leftHash: text("left_hash").notNull(),
    rightHash: text("right_hash").notNull(),
  },
);
