import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../data/sqlite/sqlSchema";
import { createListenerSet } from "./listenerSet";

export type DatabaseStatus = "idle" | "ready" | "error" | "terminated";

export interface DatabaseSnapshot {
  client: ExecSqlClientLike | null;
  execSql: ExecSql | null;
  id: string | null;
  status: DatabaseStatus;
}

export type DatabaseListener = () => void;

export interface DatabaseOptions {
  client?: ExecSqlClientLike | null | undefined;
  execSql?: ExecSql | null | undefined;
  id?: string | null | undefined;
  status?: DatabaseStatus | undefined;
}

export class Database {
  private readonly listeners = createListenerSet();
  private snapshotValue: DatabaseSnapshot = {
    client: null,
    execSql: null,
    id: null,
    status: "idle",
  };

  constructor(options?: DatabaseOptions | undefined) {
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

  get snapshot(): DatabaseSnapshot {
    return this.snapshotValue;
  }

  get status(): DatabaseStatus {
    return this.snapshotValue.status;
  }

  clear(status: DatabaseStatus = "idle"): void {
    this.setSnapshot({
      client: null,
      execSql: null,
      id: null,
      status,
    });
  }

  configure(options: DatabaseOptions): void {
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

  requireExecSql(operation = "This operation"): ExecSql {
    if (!this.snapshotValue.execSql) {
      throw new Error(`${operation} requires a configured SQLite executor.`);
    }

    return this.snapshotValue.execSql;
  }

  setClient(
    client: ExecSqlClientLike,
    options: Omit<DatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, client });
  }

  setExecSql(
    execSql: ExecSql,
    options: Omit<DatabaseOptions, "client" | "execSql"> = {},
  ): void {
    this.configure({ ...options, execSql });
  }

  subscribe = (listener: DatabaseListener): (() => void) =>
    this.listeners.subscribe(listener);

  private setSnapshot(next: DatabaseSnapshot): void {
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
    this.listeners.notify();
  }
}
