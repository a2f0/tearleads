import {
  type DatabaseConnectionEvent,
  type DatabaseConnectionState,
  transitionDatabaseConnection,
} from "./databaseConnectionMachine";
import type { initDatabase } from "./loadSqlite3";
import type { TransactionLease } from "./transactionLease";
import type { DatabaseWorkerInitOptions, DatabaseWorkerNotify } from "./types";

export type DatabaseHandle = Awaited<ReturnType<typeof initDatabase>>;

export interface ConnectionRecord {
  state: DatabaseConnectionState;
  readonly notify: DatabaseWorkerNotify;
}

export interface DatabaseEntry {
  readonly dbName: string;
  readonly db: DatabaseHandle;
  readonly optionsKey: string;
  readonly lease: TransactionLease<ConnectionRecord>;
  refCount: number;
  queue: Promise<void>;
}

// The events that take a connection off its open database.
export type DetachEvent = Extract<
  DatabaseConnectionEvent,
  { type: "released" | "databaseClosed" | "transactionRevoked" }
>;

export const CLOSED_BEFORE_INIT_MESSAGE =
  "Database connection closed before initialization completed.";

/**
 * Runs a close no request waits on, reporting its failure through `log`
 * rather than leaving it as an unhandled rejection in the worker.
 */
export function closeInBackground(
  log: (message: string) => void,
  dbName: string,
  closing: Promise<void>,
): void {
  closing.catch((error: unknown) => {
    log(
      `SQLite could not close database ${dbName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

export function initOptionsKey(options: DatabaseWorkerInitOptions): string {
  return [
    options.dbName,
    options.persistence ?? "memory",
    options.cipher,
    options.key,
  ].join("\0");
}

export function runQueued<T>(
  entry: Pick<DatabaseEntry, "queue">,
  operation: () => Promise<T> | T,
): Promise<T> {
  const queued = entry.queue.then(operation, operation);
  entry.queue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

export function applyConnectionEvent(
  record: ConnectionRecord,
  event: DatabaseConnectionEvent,
): void {
  record.state = transitionDatabaseConnection(record.state, event);
}
