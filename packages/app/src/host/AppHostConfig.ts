import type { BlobStoreFactory, LocalKeyring } from "@tearleads/client-sdk";
import type {
  SQLiteRuntime,
  StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import type { AppNavigationMode } from "../navigation/AppNavigationMode";

export type CreateSQLiteRuntimeFn = () => SQLiteRuntime;
export type CreateLocalKeyringFn = () => LocalKeyring;

export type AppHostVariant = "app" | "demo";
export type PaneRuntimePolicy = "shared" | "isolated";

export interface AppHostFeatureFlags {
  readonly explorerPeerSharing: boolean;
  readonly panePeerUserIds: boolean;
}

export interface AppHostProfile {
  readonly defaultSplit: boolean;
  readonly features: AppHostFeatureFlags;
  readonly paneRuntimePolicy: PaneRuntimePolicy;
  readonly variant: AppHostVariant;
}

export const APP_HOST_PROFILE = {
  defaultSplit: false,
  features: {
    explorerPeerSharing: false,
    panePeerUserIds: false,
  },
  paneRuntimePolicy: "shared",
  variant: "app",
} satisfies AppHostProfile;

export const DEMO_APP_HOST_PROFILE = {
  defaultSplit: true,
  features: {
    explorerPeerSharing: true,
    panePeerUserIds: true,
  },
  paneRuntimePolicy: "isolated",
  variant: "demo",
} satisfies AppHostProfile;

export interface AppHostConfigOptions {
  readonly apiBaseUrl: string;
  readonly createBlobStore?: BlobStoreFactory | undefined;
  readonly createLocalKeyring?: CreateLocalKeyringFn | undefined;
  readonly createSQLiteRuntime?: CreateSQLiteRuntimeFn | undefined;
  readonly disableLocalIdentityPersistence?: boolean | undefined;
  readonly localIdentityNamespace?: string | undefined;
  readonly navigationMode?: AppNavigationMode | undefined;
  readonly profile?: AppHostProfile | undefined;
  readonly storagePersistence?: StoragePersistencePolicy | undefined;
  readonly wsUrl: string;
}

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
    readonly profile: AppHostProfile = APP_HOST_PROFILE,
  ) {}
}

export function createAppHostConfig(
  options: AppHostConfigOptions,
): AppHostConfig {
  return new AppHostConfig(
    options.apiBaseUrl,
    options.wsUrl,
    options.createSQLiteRuntime,
    options.createBlobStore,
    options.localIdentityNamespace,
    options.createLocalKeyring,
    options.disableLocalIdentityPersistence,
    options.navigationMode,
    options.storagePersistence,
    options.profile,
  );
}
