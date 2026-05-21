import {
  createExecSql,
  type ExecSql,
  type ExecSqlClientLike,
} from "../data/sqlite/sqlSchema";

export type TearleadsDatabaseStatus = "idle" | "ready" | "error" | "terminated";

export interface TearleadsDatabaseOptions {
  client?: ExecSqlClientLike | null | undefined;
  execSql?: ExecSql | null | undefined;
  id?: string | null | undefined;
  status?: TearleadsDatabaseStatus | undefined;
}

export class TearleadsDatabase {
  private clientValue: ExecSqlClientLike | null = null;
  private execSqlValue: ExecSql | null = null;
  private idValue: string | null = null;
  private statusValue: TearleadsDatabaseStatus = "idle";

  constructor(options?: TearleadsDatabaseOptions | undefined) {
    if (options) {
      this.configure(options);
    }
  }

  get client(): ExecSqlClientLike | null {
    return this.clientValue;
  }

  get execSql(): ExecSql | null {
    return this.execSqlValue;
  }

  get id(): string | null {
    return this.idValue;
  }

  get status(): TearleadsDatabaseStatus {
    return this.statusValue;
  }

  clear(status: TearleadsDatabaseStatus = "idle"): void {
    this.clientValue = null;
    this.execSqlValue = null;
    this.idValue = null;
    this.statusValue = status;
  }

  configure(options: TearleadsDatabaseOptions): void {
    const client = options.client ?? null;
    const execSql = options.execSql ?? (client ? createExecSql(client) : null);
    if (options.status === "ready" && !execSql) {
      throw new Error(
        "A ready SQLite database requires a configured executor or client.",
      );
    }

    this.clientValue = client;
    this.execSqlValue = execSql;
    this.idValue = options.id ?? null;
    this.statusValue = options.status ?? (execSql ? "ready" : "idle");
  }

  requireClient(operation = "This operation"): ExecSqlClientLike {
    if (!this.clientValue) {
      throw new Error(`${operation} requires a configured SQLite client.`);
    }

    return this.clientValue;
  }

  requireExecSql(operation = "This operation"): ExecSql {
    if (!this.execSqlValue) {
      throw new Error(`${operation} requires a configured SQLite executor.`);
    }

    return this.execSqlValue;
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
}
