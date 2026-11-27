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
} from "./loadSqlite3";
import {
  DATABASE_NOT_INITIALIZED_MESSAGE,
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
  refCount: number;
  queue: Promise<void>;
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
  entry: DatabaseEntry,
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
  { type: "released" | "databaseClosed" }
>;

function apply(record: ConnectionRecord, event: DatabaseConnectionEvent): void {
  record.state = transitionDatabaseConnection(record.state, event);
}

class DatabaseConnectionRegistry {
  private readonly databasesByName = new Map<string, DatabaseEntry>();
  private readonly connectionsByName = new Map<string, Set<ConnectionRecord>>();
  private readonly lifecycleByName = new Map<string, Promise<void>>();
  private initializingConnections = 0;
  private openAttempts = 0;
  // Wipes run one after another, and opening waits on the last of them, so no
  // database lands in storage while any wipe is still deleting.
  private storageWipe: Promise<void> = Promise.resolve();

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

    return runQueued(entry, () => execDatabaseStatement(entry.db, options));
  }

  private async drainConnection(record: ConnectionRecord): Promise<void> {
    const dbName = databaseConnectionDbName(record.state);
    await (dbName ? this.databasesByName.get(dbName)?.queue : undefined);
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
      const created: DatabaseEntry = {
        db,
        dbName,
        optionsKey,
        refCount: 0,
        queue: Promise.resolve(),
      };
      this.databasesByName.set(dbName, created);
      return created;
    });

    return this.attachDatabase(entry, optionsKey);
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
    await this.runLifecycle(dbName, () =>
      runQueued(entry, () => deleteDatabase(entry.db)),
    );
  }

  private addConnection(dbName: string, record: ConnectionRecord): void {
    const connections = this.connectionsByName.get(dbName) ?? new Set();
    connections.add(record);
    this.connectionsByName.set(dbName, connections);
  }

  // Leave the connection's open database. Returns the database it had open;
  // only an open connection holds a share of one.
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

export function createDatabaseWorkerConnectionFactory(): (
  notify?: DatabaseWorkerNotify,
) => RegisterDatabaseWorkerOptions {
  const registry = new DatabaseConnectionRegistry();
  return (notify) => registry.createConnection(notify);
}
