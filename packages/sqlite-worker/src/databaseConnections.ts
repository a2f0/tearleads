import {
  closeDatabase,
  deleteDatabase,
  execDatabaseStatement,
  initDatabase,
} from "./loadSqlite3";
import type {
  DatabaseWorkerExecOptions,
  DatabaseWorkerExecResult,
  DatabaseWorkerInitOptions,
} from "./types";
import type { RegisterDatabaseWorkerOptions } from "./workerCore";

type DatabaseHandle = Awaited<ReturnType<typeof initDatabase>>;

interface DatabaseEntry {
  readonly dbName: string;
  readonly db: DatabaseHandle;
  readonly optionsKey: string;
  refCount: number;
  queue: Promise<void>;
}

interface ConnectionState {
  dbName: string | null;
  generation: number;
  initializing: boolean;
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

class DatabaseConnectionRegistry {
  private readonly databasesByName = new Map<string, DatabaseEntry>();
  private readonly connectionsByName = new Map<string, Set<ConnectionState>>();
  private readonly lifecycleByName = new Map<string, Promise<void>>();

  createConnection(): RegisterDatabaseWorkerOptions {
    const state: ConnectionState = {
      dbName: null,
      generation: 0,
      initializing: false,
    };

    return {
      onInit: (options) => this.initConnection(state, options),
      onExec: (options) => this.execForConnection(state, options),
      onClose: () => this.closeConnection(state),
      onDelete: () => this.deleteConnection(state),
    };
  }

  private async initConnection(
    state: ConnectionState,
    options: DatabaseWorkerInitOptions,
  ): Promise<void> {
    if (state.dbName || state.initializing) {
      throw new Error("Database has already been initialized.");
    }

    const generation = state.generation;
    state.initializing = true;

    try {
      const entry = await this.acquireDatabase(options);
      if (state.generation !== generation || state.dbName) {
        await this.releaseDatabase(entry.dbName);
        throw new Error(
          "Database connection closed before initialization completed.",
        );
      }

      state.dbName = entry.dbName;
      this.addConnection(entry.dbName, state);
    } finally {
      state.initializing = false;
    }
  }

  private async execForConnection(
    state: ConnectionState,
    options: DatabaseWorkerExecOptions,
  ): Promise<DatabaseWorkerExecResult["rows"]> {
    const dbName = state.dbName;
    if (!dbName) {
      throw new Error("Database has not been initialized.");
    }

    const entry = this.databasesByName.get(dbName);
    if (!entry) {
      this.detachConnection(state);
      throw new Error("Database has not been initialized.");
    }

    return runQueued(entry, () => execDatabaseStatement(entry.db, options));
  }

  private async acquireDatabase(
    options: DatabaseWorkerInitOptions,
  ): Promise<DatabaseEntry> {
    const { dbName } = options;
    const optionsKey = initOptionsKey(options);

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

  private async closeConnection(state: ConnectionState): Promise<void> {
    state.generation += 1;
    const dbName = this.detachConnection(state);
    if (dbName) {
      await this.releaseDatabase(dbName);
    }
  }

  private async deleteConnection(state: ConnectionState): Promise<void> {
    state.generation += 1;
    const dbName = state.dbName;
    if (!dbName) {
      return;
    }

    await this.deleteDatabase(dbName);
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

  private async deleteDatabase(dbName: string): Promise<void> {
    const connections = this.connectionsByName.get(dbName);
    if (connections) {
      for (const connection of connections) {
        connection.dbName = null;
        connection.generation += 1;
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

  private addConnection(dbName: string, state: ConnectionState): void {
    const connections = this.connectionsByName.get(dbName) ?? new Set();
    connections.add(state);
    this.connectionsByName.set(dbName, connections);
  }

  private detachConnection(state: ConnectionState): string | null {
    const dbName = state.dbName;
    state.dbName = null;
    if (!dbName) {
      return null;
    }

    const connections = this.connectionsByName.get(dbName);
    connections?.delete(state);
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

export function createDatabaseWorkerConnectionFactory(): () => RegisterDatabaseWorkerOptions {
  const registry = new DatabaseConnectionRegistry();
  return () => registry.createConnection();
}
