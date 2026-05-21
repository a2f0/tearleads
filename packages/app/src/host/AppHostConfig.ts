import type { SQLiteWorkerRuntime } from "@tearleads/client-sdk/sqlite";

export type CreateSQLiteWorkerRuntimeFn = () => SQLiteWorkerRuntime;

export class AppHostConfig {
  constructor(
    readonly apiBaseUrl: string,
    readonly wsUrl: string,
    readonly createSQLiteWorkerRuntime?: CreateSQLiteWorkerRuntimeFn,
  ) {}
}
