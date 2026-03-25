import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  fingerprint: text("fingerprint").notNull().unique(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const items = pgTable("items", {
  id: uuid("id").defaultRandom().primaryKey(),
  payload: text("payload").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  spicedbZedToken: text("spicedb_zed_token").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
