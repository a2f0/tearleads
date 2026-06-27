import type { BlobStoreFactory, LocalKeyring } from "@tearleads/client-sdk";
import type {
  SQLiteRuntime,
  StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import type { AppNavigationMode } from "../navigation/AppNavigationMode";

export type CreateSQLiteRuntimeFn = () => SQLiteRuntime;
export type CreateLocalKeyringFn = () => LocalKeyring;

export type PaneRuntimePolicy = "shared" | "isolated";

export interface AppHostFeatureFlags {
  /**
   * Derive an identity key pair (signing + encapsulation keys) automatically on
   * boot when none exists, instead of waiting for the user to click "Generate
   * Key Pair". Gated on the local keychain being unlocked and the initial
   * persisted-identity restore having settled, so a returning user's stored
   * identity is restored rather than clobbered by a freshly generated one.
   */
  readonly autoGenerateIdentity: boolean;
  /**
   * Register the current identity automatically as soon as it is registerable
   * (key pair present, root container bootstrapped, not yet registered),
   * provisioning the org and logging the user in without a manual "Register".
   */
  readonly autoRegisterIdentity: boolean;
  readonly explorerPeerSharing: boolean;
  readonly panePeerUserIds: boolean;
}

export interface AppHostProfile {
  readonly defaultSplit: boolean;
  readonly features: AppHostFeatureFlags;
  readonly paneRuntimePolicy: PaneRuntimePolicy;
}

// Registry of named host profiles. The registry key IS the variant id, so
// adding a product variant is a single entry here — no new package, no union to
// widen, no env branch to extend. Selection happens via resolveAppHostProfile.
export const APP_HOST_PROFILES = {
  app: {
    defaultSplit: false,
    features: {
      autoGenerateIdentity: true,
      autoRegisterIdentity: true,
      explorerPeerSharing: false,
      panePeerUserIds: false,
    },
    paneRuntimePolicy: "shared",
  },
  demo: {
    defaultSplit: true,
    features: {
      autoGenerateIdentity: true,
      autoRegisterIdentity: true,
      explorerPeerSharing: true,
      panePeerUserIds: true,
    },
    paneRuntimePolicy: "isolated",
  },
} satisfies Record<string, AppHostProfile>;

type AppHostVariant = keyof typeof APP_HOST_PROFILES;

const DEFAULT_APP_HOST_PROFILE: AppHostProfile = APP_HOST_PROFILES.app;

function isKnownAppHostVariant(variant: string): variant is AppHostVariant {
  return Object.hasOwn(APP_HOST_PROFILES, variant);
}

/**
 * Resolves a host profile from a variant id (e.g. `BUN_PUBLIC_APP_VARIANT`). An
 * unset variant — `undefined`, or the empty string some bundlers emit for an
 * unset env var — falls back to the default `app` profile; an unknown non-empty
 * variant throws rather than silently degrading, so a misconfigured deploy fails
 * loudly instead of shipping the wrong variant to a domain.
 */
export function resolveAppHostProfile(
  variant: string | undefined,
): AppHostProfile {
  if (variant === undefined || variant === "") {
    return DEFAULT_APP_HOST_PROFILE;
  }
  if (!isKnownAppHostVariant(variant)) {
    throw new Error(`Unknown app host variant: ${variant}`);
  }
  return APP_HOST_PROFILES[variant];
}

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
    readonly profile: AppHostProfile = DEFAULT_APP_HOST_PROFILE,
  ) {}

  /**
   * Returns a copy with the given fields patched. Uses key-presence semantics
   * (the spread copies an explicit `undefined`, clearing the field) so a caller
   * can reset e.g. `localIdentityNamespace` to undefined. Replaces the ad-hoc
   * positional re-construction that clone sites would otherwise repeat.
   */
  withOverrides(overrides: Partial<AppHostConfigOptions>): AppHostConfig {
    return createAppHostConfig({
      apiBaseUrl: this.apiBaseUrl,
      wsUrl: this.wsUrl,
      createSQLiteRuntime: this.createSQLiteRuntime,
      createBlobStore: this.createBlobStore,
      localIdentityNamespace: this.localIdentityNamespace,
      createLocalKeyring: this.createLocalKeyring,
      disableLocalIdentityPersistence: this.disableLocalIdentityPersistence,
      navigationMode: this.navigationMode,
      storagePersistence: this.storagePersistence,
      profile: this.profile,
      ...overrides,
    });
  }
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
