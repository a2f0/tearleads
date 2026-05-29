import type { BlobStoreFactory } from "@tearleads/client-sdk";
import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";

export type CreateSQLiteRuntimeFn = () => SQLiteRuntime;

export class AppHostConfig {
  constructor(
    readonly apiBaseUrl: string,
    readonly wsUrl: string,
    readonly createSQLiteRuntime?: CreateSQLiteRuntimeFn,
    readonly createBlobStore?: BlobStoreFactory,
  ) {}
}
