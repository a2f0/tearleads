import type { BlobStoreFactory, LocalKeyring } from "@tearleads/client-sdk";
import type {
  SQLiteRuntime,
  StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import type { AppNavigationMode } from "../navigation/AppNavigationMode";

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
    readonly navigationMode?: AppNavigationMode | undefined,
    /**
     * How the local SQLite database and OPFS blob store are persisted. When
     * omitted, {@link DatabaseProvider} auto-detects (persistent OPFS-SAHPool
     * when OPFS is available, in-memory otherwise). Platform shells that always
     * have OPFS can pass `PERSISTENT_STORAGE_POLICY` explicitly.
     */
    readonly storagePersistence?: StoragePersistencePolicy | undefined,
  ) {}
}
