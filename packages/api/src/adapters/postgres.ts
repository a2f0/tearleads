import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../schema";

const client = new PGlite({ debug: 0 });
export const db = drizzle({ client, schema });

export type ApiDatabase = typeof db;
type TransactionCallback = Parameters<ApiDatabase["transaction"]>[0];
export type DatabaseTransaction = Parameters<TransactionCallback>[0];
export type DatabaseSession = Pick<
  ApiDatabase,
  "delete" | "execute" | "insert" | "select" | "update"
>;

const migrationsFolder = fileURLToPath(
  new URL("../../drizzle", import.meta.url),
);
await migrate(db, { migrationsFolder });

export default client;
