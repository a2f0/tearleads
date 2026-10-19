import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Immutable authority for a personal organization's signed replacement. */
export const organizationFounders = sqliteTable("organization_founders", {
  organizationId: text("organization_id").primaryKey(),
  userId: text("user_id").notNull(),
  signingKeyFingerprint: text("signing_key_fingerprint").notNull(),
  genesisStateHash: text("genesis_state_hash").notNull(),
});
