import type { PgliteDatabase } from "drizzle-orm/pglite";
import type * as schema from "../schema";
import type { ApiDatabaseKind } from "../schema/dialect";

export type { ApiDatabaseKind };

export type ApiSchema = typeof schema;
export type ApiDatabaseSurface = Pick<
  PgliteDatabase<ApiSchema>,
  "delete" | "execute" | "insert" | "select" | "transaction" | "update"
>;
export type ApiDatabase = ApiDatabaseSurface;
export type TransactionCallback = Parameters<ApiDatabase["transaction"]>[0];
export type DatabaseTransaction = Parameters<TransactionCallback>[0];
// Shared statement surface for helpers that can run against either the root
// database or an active transaction, without starting their own transaction.
export type DatabaseSession = Pick<
  ApiDatabase,
  "delete" | "execute" | "insert" | "select" | "update"
>;

export interface MigrationOptions {
  readonly migrationsFolder?: string;
}

export interface ManagedApiDatabase {
  readonly db: ApiDatabase;
  readonly kind: ApiDatabaseKind;
  close(): Promise<void>;
  migrate(options?: MigrationOptions): Promise<void>;
}
