import type { Sqlite3Static } from "@tearleads/sqlite-instance";
import { isDatabaseInAutocommit } from "./autocommit";
import {
  canOpenDatabaseConnection,
  type DatabaseConnectionEvent,
  type DatabaseConnectionState,
  databaseConnectionDbName,
  databaseConnectionRefusal,
  transitionDatabaseConnection,
  UNOPENED_DATABASE_CONNECTION,
} from "./databaseConnectionMachine";
import {
  closeDatabase,
  deleteDatabase,
  execDatabaseStatement,
  hasPersistentVfs,
  initDatabase,
  loadSqlite3,
} from "./loadSqlite3";
import {
  TransactionLease,
  type TransactionLeaseBounds,
  type TransactionLeaseRevocation,
} from "./transactionLease";
import {
  TRANSACTION_LEASE_IDLE_MS,
  TRANSACTION_LEASE_WAIT_MS,
} from "./transactionLeaseMachine";
import {
  DATABASE_DELETED_MESSAGE,
  DATABASE_NOT_INITIALIZED_MESSAGE,
  DATABASE_TRANSACTION_REVOKED_MESSAGE,
  type DatabaseWorkerExecOptions,
  type DatabaseWorkerExecResult,
  type DatabaseWorkerInitOptions,
  type DatabaseWorkerNotify,
  WORKER_DATABASE_DELETED_MESSAGE_TYPE,
} from "./types";
import { wipeOpfsStorage } from "./wipeOpfsStorage";
import type { RegisterDatabaseWorkerOptions } from "./workerCore";

type DatabaseHandle = Awaited<ReturnType<typeof initDatabase>>;

interface ConnectionRecord {
  state: DatabaseConnectionState;
  readonly notify: DatabaseWorkerNotify;
}

interface DatabaseEntry {
  readonly dbName: string;
  readonly db: DatabaseHandle;
  readonly optionsKey: string;
  readonly lease: TransactionLease<ConnectionRecord>;
  refCount: number;
  queue: Promise<void>;
}

export interface DatabaseConnectionRegistryOptions {
  readonly leaseBounds?: Partial<TransactionLeaseBounds>;
  /** Where revocations are reported. No SQL text or bind values reach it. */
  readonly log?: (message: string) => void;
}

function initOptionsKey(options: DatabaseWorkerInitOptions): string {
  return [
    options.dbName,
    options.persistence ?? "memory",
    options.cipher,
    options.key,
  ].join("\0");
}

function runQueued<T>(
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

// The events that take a connection off its open database.
type DetachEvent = Extract<
  DatabaseConnectionEvent,
  { type: "released" | "databaseClosed" | "transactionRevoked" }
>;

function apply(record: ConnectionRecord, event: DatabaseConnectionEvent): void {
  record.state = transitionDatabaseConnection(record.state, event);
}

class DatabaseConnectionRegistry {
  private readonly databasesByName = new Map<string, DatabaseEntry>();
  private readonly connectionsByName = new Map<string, Set<ConnectionRecord>>();
  private readonly lifecycleByName = new Map<string, Promise<void>>();
  private readonly leaseBounds: TransactionLeaseBounds;
  private readonly log: (message: string) => void;
  private initializingConnections = 0;
  private openAttempts = 0;
  // Wipes run one after another, and opening waits on the last of them, so no
  // database lands in storage while any wipe is still deleting.
  private storageWipe: Promise<void> = Promise.resolve();

  constructor(options: DatabaseConnectionRegistryOptions) {
    this.leaseBounds = {
      idleMs: options.leaseBounds?.idleMs ?? TRANSACTION_LEASE_IDLE_MS,
      waitMs: options.leaseBounds?.waitMs ?? TRANSACTION_LEASE_WAIT_MS,
    };
    this.log = options.log ?? ((message) => console.warn(message));
  }

  createConnection(
    notify: DatabaseWorkerNotify = () => {},
  ): RegisterDatabaseWorkerOptions {
    const record: ConnectionRecord = {
      notify,
      state: UNOPENED_DATABASE_CONNECTION,
    };

    return {
      onInit: (options) => this.initConnection(record, options),
      onExec: (options) => this.execForConnection(record, options),
      onClose: () => this.closeConnection(record),
      // Opening a replacement database waits for the app's reset operation.
      // Drain the live worker before the host commits to closing or wiping it.
      onPrepareDelete: () => this.drainConnection(record),
      onDelete: () => this.deleteConnection(record),
      onWipeStorage: () => this.wipeStorage(),
    };
  }

  private async initConnection(
    record: ConnectionRecord,
    options: DatabaseWorkerInitOptions,
  ): Promise<void> {
    if (!canOpenDatabaseConnection(record.state)) {
      throw new Error("Database has already been initialized.");
    }

    this.openAttempts += 1;
    const attempt = this.openAttempts;
    apply(record, { type: "openStarted", attempt });
    this.initializingConnections += 1;

    try {
      const entry = await this.acquireDatabase(options);
      // A close or delete overtook the open. Give back what it acquired
      // while the connection is still opening, so no second init starts
      // before the release finishes.
      if (
        record.state.status !== "opening" ||
        record.state.attempt !== attempt ||
        record.state.released
      ) {
        await this.releaseDatabase(entry.dbName);
        throw new Error(
          "Database connection closed before initialization completed.",
        );
      }

      apply(record, { type: "openSucceeded", attempt, dbName: entry.dbName });
      this.addConnection(entry.dbName, record);
    } catch (error) {
      apply(record, { type: "openFailed", attempt });
      throw error;
    } finally {
      this.initializingConnections -= 1;
    }
  }

  private async execForConnection(
    record: ConnectionRecord,
    options: DatabaseWorkerExecOptions,
  ): Promise<DatabaseWorkerExecResult["rows"]> {
    if (record.state.status !== "open") {
      throw new Error(databaseConnectionRefusal(record.state));
    }

    const entry = this.databasesByName.get(record.state.dbName);
    if (!entry) {
      this.detachConnection(record, { type: "databaseClosed" });
      throw new Error(DATABASE_NOT_INITIALIZED_MESSAGE);
    }

    return entry.lease.submit(record, () =>
      execDatabaseStatement(entry.db, options),
    );
  }

  private async drainConnection(record: ConnectionRecord): Promise<void> {
    const dbName = databaseConnectionDbName(record.state);
    const entry = dbName ? this.databasesByName.get(dbName) : undefined;
    if (!entry) {
      return;
    }
    await entry.lease.settled(record);
    await entry.queue;
  }

  private async wipeStorage(): Promise<void> {
    if (
      this.initializingConnections > 0 ||
      this.databasesByName.size > 0 ||
      hasPersistentVfs()
    ) {
      throw new Error(
        "Storage can only be wiped before this worker opens a database.",
      );
    }

    const wipe = this.storageWipe.then(() => wipeOpfsStorage());
    this.storageWipe = wipe.then(
      () => undefined,
      () => undefined,
    );
    await wipe;
  }

  private async acquireDatabase(
    options: DatabaseWorkerInitOptions,
  ): Promise<DatabaseEntry> {
    const { dbName } = options;
    const optionsKey = initOptionsKey(options);

    await this.storageWipe;

    await this.waitForLifecycle(dbName);

    const existing = this.databasesByName.get(dbName);
    if (existing) {
      return this.attachDatabase(existing, optionsKey);
    }

    const entry = await this.runLifecycle(dbName, async () => {
      const openedByEarlierWaiter = this.databasesByName.get(dbName);
      if (openedByEarlierWaiter) {
        return openedByEarlierWaiter;
      }

      const db = await initDatabase(options);
      // Opening loaded SQLite, so this resolves to the loaded module at once.
      const { capi } = await loadSqlite3();
      const created = this.createEntry(dbName, db, optionsKey, capi);
      this.databasesByName.set(dbName, created);
      return created;
    });

    return this.attachDatabase(entry, optionsKey);
  }

  private createEntry(
    dbName: string,
    db: DatabaseHandle,
    optionsKey: string,
    capi: Sqlite3Static["capi"],
  ): DatabaseEntry {
    const entry: DatabaseEntry = {
      db,
      dbName,
      lease: new TransactionLease<ConnectionRecord>({
        bounds: this.leaseBounds,
        enqueue: (operation) => {
          void runQueued(entry, operation);
        },
        fail: () => this.failDatabase(entry),
        isAutocommit: () => isDatabaseInAutocommit(capi, db),
        now: () => Date.now(),
        revoke: (holder, revocation) =>
          this.revokeConnection(entry, holder, revocation),
        rollback: () => {
          db.exec("ROLLBACK");
        },
      }),
      optionsKey,
      queue: Promise.resolve(),
      refCount: 0,
    };
    return entry;
  }

  private attachDatabase(
    entry: DatabaseEntry,
    optionsKey: string,
  ): DatabaseEntry {
    if (entry.optionsKey !== optionsKey) {
      throw new Error(
        "Database is already initialized with different options.",
      );
    }

    entry.refCount += 1;
    return entry;
  }

  private async closeConnection(record: ConnectionRecord): Promise<void> {
    const dbName = this.detachConnection(record, { type: "released" });
    if (dbName) {
      await this.releaseDatabase(dbName);
    }
  }

  private async deleteConnection(record: ConnectionRecord): Promise<void> {
    const dbName = databaseConnectionDbName(record.state);
    apply(record, { type: "released" });
    if (!dbName) {
      return;
    }

    await this.deleteDatabase(dbName, record);
  }

  // A revoked holder's open was already released, and a delete removes the
  // whole database, so only an open connection gives its share back here.
  private async releaseDatabase(dbName: string): Promise<void> {
    const entry = this.databasesByName.get(dbName);
    if (!entry) {
      return;
    }

    entry.refCount = Math.max(0, entry.refCount - 1);
    if (entry.refCount > 0) {
      return;
    }

    this.databasesByName.delete(dbName);
    entry.lease.dispose(() => DATABASE_NOT_INITIALIZED_MESSAGE);
    await this.runLifecycle(dbName, () =>
      runQueued(entry, () => closeDatabase(entry.db)),
    );
  }

  private async deleteDatabase(
    dbName: string,
    deleting: ConnectionRecord,
  ): Promise<void> {
    const connections = this.connectionsByName.get(dbName);
    if (connections) {
      for (const connection of connections) {
        if (connection !== deleting) {
          apply(connection, { type: "deletedElsewhere" });
          connection.notify({ type: WORKER_DATABASE_DELETED_MESSAGE_TYPE });
        }
      }
      this.connectionsByName.delete(dbName);
    }

    const entry = this.databasesByName.get(dbName);
    if (!entry) {
      return;
    }

    entry.refCount = 0;
    this.databasesByName.delete(dbName);
    entry.lease.dispose((connection) =>
      connection === deleting
        ? DATABASE_NOT_INITIALIZED_MESSAGE
        : DATABASE_DELETED_MESSAGE,
    );
    await this.runLifecycle(dbName, () =>
      runQueued(entry, () => deleteDatabase(entry.db)),
    );
  }

  // The holder sent nothing for the idle bound while another connection
  // waited, and its transaction is rolled back. Retire the connection so its
  // next statement cannot run as if the transaction were still open; it
  // recovers by opening the database again.
  private revokeConnection(
    entry: DatabaseEntry,
    holder: ConnectionRecord,
    revocation: TransactionLeaseRevocation,
  ): void {
    const detail = `database ${entry.dbName}, idle ${revocation.idleMs} ms, ${revocation.waiting} statement(s) waiting`;
    this.log(`SQLite transaction lease revoked (${detail}).`);
    const refusal = `${DATABASE_TRANSACTION_REVOKED_MESSAGE} (${detail})`;
    entry.lease.refuseConnection(holder, refusal);
    if (
      this.detachConnection(holder, { type: "transactionRevoked", refusal })
    ) {
      this.closeInBackground(entry.dbName, this.releaseDatabase(entry.dbName));
    }
  }

  // A close no request waits on still reports its failure, rather than
  // leaving it as an unhandled rejection in the worker.
  private closeInBackground(dbName: string, closing: Promise<void>): void {
    closing.catch((error: unknown) => {
      this.log(
        `SQLite could not close database ${dbName}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  // The forced rollback left the handle inside a transaction: close the
  // database, so every connection opens it again and SQLite's journal rolls
  // the transaction back.
  private failDatabase(entry: DatabaseEntry): void {
    this.log(
      `SQLite transaction lease could not end a transaction (database ${entry.dbName}); closing it.`,
    );
    if (this.databasesByName.get(entry.dbName) !== entry) {
      // The last connection already closed it.
      return;
    }
    for (const connection of this.connectionsByName.get(entry.dbName) ?? []) {
      apply(connection, { type: "databaseClosed" });
    }
    this.connectionsByName.delete(entry.dbName);
    entry.refCount = 0;
    this.databasesByName.delete(entry.dbName);
    entry.lease.dispose(() => DATABASE_NOT_INITIALIZED_MESSAGE);
    this.closeInBackground(
      entry.dbName,
      this.runLifecycle(entry.dbName, () =>
        runQueued(entry, () => closeDatabase(entry.db)),
      ),
    );
  }

  private addConnection(dbName: string, record: ConnectionRecord): void {
    const connections = this.connectionsByName.get(dbName) ?? new Set();
    connections.add(record);
    this.connectionsByName.set(dbName, connections);
  }

  // Leave the connection's open database: refuse its waiting statements and
  // end any transaction it holds. Returns the database it had open; only an
  // open connection holds a share of one, so a revoked connection's close
  // gives nothing back twice.
  private detachConnection(
    record: ConnectionRecord,
    event: DetachEvent,
  ): string | null {
    const dbName = record.state.status === "open" ? record.state.dbName : null;
    apply(record, event);
    if (!dbName) {
      return null;
    }

    const connections = this.connectionsByName.get(dbName);
    connections?.delete(record);
    if (connections?.size === 0) {
      this.connectionsByName.delete(dbName);
    }
    if (event.type !== "transactionRevoked") {
      this.databasesByName
        .get(dbName)
        ?.lease.close(record, DATABASE_NOT_INITIALIZED_MESSAGE);
    }

    return dbName;
  }

  private async waitForLifecycle(dbName: string): Promise<void> {
    await this.lifecycleByName.get(dbName);
  }

  private async runLifecycle<T>(
    dbName: string,
    operation: () => Promise<T> | T,
  ): Promise<T> {
    const previous = this.lifecycleByName.get(dbName) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    this.lifecycleByName.set(dbName, lifecycle);

    try {
      return await result;
    } finally {
      if (this.lifecycleByName.get(dbName) === lifecycle) {
        this.lifecycleByName.delete(dbName);
      }
    }
  }
}

export function createDatabaseWorkerConnectionFactory(
  options: DatabaseConnectionRegistryOptions = {},
): (notify?: DatabaseWorkerNotify) => RegisterDatabaseWorkerOptions {
  const registry = new DatabaseConnectionRegistry(options);
  return (notify) => registry.createConnection(notify);
}
