import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../data/sqlite/sqlSchema";

export type TearleadsDatabaseStatus = "idle" | "ready" | "error" | "terminated";

export interface TearleadsDatabaseSnapshot {
  client: ExecSqlClientLike | null;
  execSql: ExecSql | null;
  id: string | null;
  status: TearleadsDatabaseStatus;
}

export type TearleadsDatabaseListener = () => void;

export interface TearleadsDatabaseOptions {
  client?: ExecSqlClientLike | null | undefined;
  execSql?: ExecSql | null | undefined;
  id?: string | null | undefined;
  status?: TearleadsDatabaseStatus | undefined;
}

export class TearleadsDatabase {
  private readonly listeners = new Set<TearleadsDatabaseListener>();
  private snapshotValue: TearleadsDatabaseSnapshot = {
    client: null,
    execSql: null,
    id: null,
    status: "idle",
  };

  constructor(options?: TearleadsDatabaseOptions | undefined) {
    if (options) {
      this.configure(options);
    }
  }

  get client(): ExecSqlClientLike | null {
    return this.snapshotValue.client;
  }

  get execSql(): ExecSql | null {
    return this.snapshotValue.execSql;
  }

  get id(): string | null {
    return this.snapshotValue.id;
  }

  get snapshot(): TearleadsDatabaseSnapshot {
    return this.snapshotValue;
  }

  get status(): TearleadsDatabaseStatus {
    return this.snapshotValue.status;
  }

  clear(status: TearleadsDatabaseStatus = "idle"): void {
    this.setSnapshot({
      client: null,
      execSql: null,
      id: null,
      status,
    });
  }

  configure(options: TearleadsDatabaseOptions): void {
    const client = options.client ?? null;
    const execSql = options.execSql ?? (client ? createExecSql(client) : null);
    if (options.status === "ready" && !execSql) {
      throw new Error(
        "A ready SQLite database requires a configured executor or client.",
      );
    }

    this.setSnapshot({
      client,
      execSql,
      id: options.id ?? null,
      status: options.status ?? (execSql ? "ready" : "idle"),
    });
  }

  requireClient(operation = "This operation"): ExecSqlClientLike {
    if (!this.snapshotValue.client) {
      throw new Error(`${operation} requires a configured SQLite client.`);
    }

    return this.snapshotValue.client;
  }

  requireExecSql(operation = "This operation"): ExecSql {
    if (!this.snapshotValue.execSql) {
      throw new Error(`${operation} requires a configured SQLite executor.`);
    }

    return this.snapshotValue.execSql;
  }

  setClient(
    client: ExecSqlClientLike,
    options: Omit<TearleadsDatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, client });
  }

  setExecSql(
    execSql: ExecSql,
    options: Omit<TearleadsDatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, execSql });
  }

  subscribe = (listener: TearleadsDatabaseListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Keep one subscriber failure from blocking later subscribers.
      }
    }
  }

  private setSnapshot(next: TearleadsDatabaseSnapshot): void {
    const previous = this.snapshotValue;
    if (
      previous.client === next.client &&
      previous.execSql === next.execSql &&
      previous.id === next.id &&
      previous.status === next.status
    ) {
      return;
    }

    this.snapshotValue = next;
    this.notifyListeners();
  }
}
