import type { BlobStoreFactory, LocalKeyring } from "@tearleads/client-sdk";
import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";

export type CreateSQLiteRuntimeFn = () => SQLiteRuntime;
export type CreateLocalKeyringFn = () => LocalKeyring;

export class AppHostConfig {
  constructor(
    readonly apiBaseUrl: string,
    readonly wsUrl: string,
    readonly createSQLiteRuntime?: CreateSQLiteRuntimeFn,
    readonly createBlobStore?: BlobStoreFactory,
    readonly localIdentityNamespace?: string | undefined,
    readonly createLocalKeyring?: CreateLocalKeyringFn | undefined,
    readonly disableLocalIdentityPersistence?: boolean | undefined,
  ) {}
}
