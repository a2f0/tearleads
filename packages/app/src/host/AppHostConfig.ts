import type {
  BlobStoreFactory,
  DirectCheckoutCapability,
  FileSaver,
  LocalKeyring,
  NetworkStatusSource,
  PurchasesCapability,
  WrappingKeyMaterialStorage,
} from "@tearleads/client-sdk";
import type {
  SQLiteRuntime,
  StoragePersistencePolicy,
} from "@tearleads/client-sdk/sqlite";
import type { AppNavigationMode } from "../navigation/AppNavigationMode";
import type { AppBuildInfo } from "./AppBuildInfo";
import type { CreateFileViewerFn } from "./FileViewer";
import type { CreateScannerFn } from "./Scanner";

export { createAppBuildInfo } from "./AppBuildInfo";
export type { FileViewer } from "./FileViewer";
export type { Scanner } from "./Scanner";

export type CreateSQLiteRuntimeFn = () => SQLiteRuntime;
/** @public */
export type CreateLocalKeyringFn = () => LocalKeyring;
export type CreatePurchasesFn = () => PurchasesCapability;

/**
 * Builds the platform's file-saver — the "download" action. Only shells whose
 * WebView has no browser download destination supply one: Capacitor writes the
 * bytes and opens the native share sheet, Electrobun writes to the user's
 * Downloads folder. When omitted (web, tests) the app falls back to the browser
 * saver (a hidden `<a download>` click). See {@link FileSaver}.
 */
type CreateFileSaverFn = () => FileSaver;

/**
 * Builds the platform's connectivity source. Only shells whose runtime cannot
 * trust `navigator.onLine` supply one — chiefly Capacitor, whose Android
 * WebView routinely reports offline while the device is connected. When
 * omitted the app falls back to the browser source (`navigator.onLine` plus
 * the window `online`/`offline` events).
 */
export type CreateNetworkStatusFn = () => NetworkStatusSource;

/**
 * Subscribes to native connection-validity boundaries. Capacitor supplies this
 * for app resumes and transport changes because an iOS WebView can retain a
 * WebSocket that reports `OPEN` after its underlying path has died.
 */
export type SubscribeConnectionRefreshFn = (listener: () => void) => () => void;
/** Supplies native keyboard state when WebView resizing hides viewport changes. */
export type SubscribeKeyboardVisibilityFn = (
  listener: (visible: boolean) => void,
) => () => void;

/**
 * Builds the platform's direct card-checkout capability (issue #1654). Only
 * the web shell supplies one; elsewhere billing falls back to the
 * provider-hosted purchase flow.
 */
type CreateDirectCheckoutFn = () => DirectCheckoutCapability;

/**
 * Reads the native application's build number at runtime — Android's
 * `versionCode`, iOS's `CFBundleVersion`. Unlike {@link AppBuildInfo}'s
 * `version` and `commit`, the build number is not a build-time value a bundler
 * can inline: the release tooling (fastlane) stamps it into the native project,
 * so only the native shells know it and only at runtime. Capacitor supplies one
 * backed by `@capacitor/app`'s `App.getInfo()`; when omitted (web, electrobun,
 * tests) the Environment tab reports the build number as unknown.
 */
export type ReadNativeBuildNumberFn = () => Promise<string>;

/**
 * Opens the platform's subscription-management experience for a provider URL.
 * Native shells may replace a store URL with first-party UI (for example,
 * StoreKit's sandbox-aware sheet on iOS); browser shells omit the capability
 * and let the billing view open the URL directly.
 */
export type OpenSubscriptionManagementFn = (
  managementUrl: string,
) => Promise<void>;

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
  /**
   * Seed friendly peer identities on boot: auto-import the opposite pane's peer
   * as a contact (nicknamed by its peer label), name the self "You" contact and
   * the bootstrapped personal org after the pane's peer label ("Peer 1"/"Peer
   * 2" / "Peer 1's Org"). Demo-only sugar so the two-pane demo reads as two
   * named people rather than raw key fingerprints; the regular app leaves this
   * off and keeps the neutral "Personal Org" / "You" defaults and the manual
   * contact-import flow.
   */
  readonly seedPeerIdentities: boolean;
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
      seedPeerIdentities: false,
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
      seedPeerIdentities: true,
    },
    paneRuntimePolicy: "isolated",
  },
  // Screenshot fixture setup imports a fixed identity and restores its database
  // before registering. Suppress only the automatic registration step so it
  // cannot bind the temporary first-boot root; the Playwright harness explicitly
  // logs in or registers once the restored root is authoritative.
  screenshot: {
    defaultSplit: false,
    features: {
      autoGenerateIdentity: true,
      autoRegisterIdentity: false,
      explorerPeerSharing: false,
      panePeerUserIds: false,
      seedPeerIdentities: false,
    },
    paneRuntimePolicy: "shared",
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

/** @public */
export interface AppHostConfigOptions {
  readonly apiBaseUrl: string;
  readonly buildInfo?: AppBuildInfo | undefined;
  readonly createBlobStore?: BlobStoreFactory | undefined;
  readonly createLocalKeyring?: CreateLocalKeyringFn | undefined;
  readonly createPurchases?: CreatePurchasesFn | undefined;
  readonly createDirectCheckout?: CreateDirectCheckoutFn | undefined;
  readonly createFileSaver?: CreateFileSaverFn | undefined;
  readonly createFileViewer?: CreateFileViewerFn | undefined;
  readonly createNetworkStatus?: CreateNetworkStatusFn | undefined;
  readonly createScanner?: CreateScannerFn | undefined;
  readonly subscribeConnectionRefresh?:
    | SubscribeConnectionRefreshFn
    | undefined;
  readonly subscribeKeyboardVisibility?:
    | SubscribeKeyboardVisibilityFn
    | undefined;
  readonly createSQLiteRuntime?: CreateSQLiteRuntimeFn | undefined;
  readonly disableLocalIdentityPersistence?: boolean | undefined;
  readonly localIdentityNamespace?: string | undefined;
  /**
   * How the local keyring's IndexedDB wrapping key is persisted. WebView shells
   * (Capacitor, Electrobun) pass `"raw-bytes"` because WKWebView cannot
   * structured-clone a CryptoKey; browsers leave it unset for the default
   * non-extractable CryptoKey.
   *
   * Prefer this over supplying {@link AppHostConfigOptions.createLocalKeyring}
   * for that purpose. Overriding the whole factory takes keyring construction
   * away from `LocalKeyringLockProvider`, which disables PIN locking outright;
   * declaring only the mode leaves the provider in charge, so a WebView shell
   * keeps PIN locking while still getting the record shape it needs.
   */
  readonly localKeyringKeyMaterialStorage?:
    | WrappingKeyMaterialStorage
    | undefined;
  readonly navigationMode?: AppNavigationMode | undefined;
  readonly openSubscriptionManagement?:
    | OpenSubscriptionManagementFn
    | undefined;
  readonly profile?: AppHostProfile | undefined;
  readonly readNativeBuildNumber?: ReadNativeBuildNumberFn | undefined;
  /**
   * Reuse one long-lived SQLite worker across identity (database) switches by
   * closing the current database and re-initializing the same worker onto the
   * next one, instead of tearing the worker down and constructing a new one.
   * Only native WebView shells (Capacitor) set this, and only alongside a
   * dedicated worker: constructing a *second* worker fails on a WebView (a
   * cross-tab owner re-election never answers `init`; a fresh dedicated module
   * Worker errors on construction), which wedged provisioning of a second local
   * identity. The multi-tab web shell keeps the default cross-tab teardown.
   */
  readonly reuseDatabaseWorker?: boolean | undefined;
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
    /**
     * In-app purchases capability (RevenueCat) for org sync billing. Platform
     * shells with a purchases provider inject a real implementation; when
     * omitted the app falls back to the unavailable stub.
     */
    readonly createPurchases?: CreatePurchasesFn | undefined,
    /**
     * Build identity for the running bundle. Omitted by tests and by any shell
     * that does not stamp one; the Environment tab reports it as unknown rather
     * than hiding the row, so a support report never looks like it was captured
     * from a build that simply has no version.
     */
    readonly buildInfo?: AppBuildInfo | undefined,
    readonly createDirectCheckout?: CreateDirectCheckoutFn | undefined,
    /**
     * Connectivity source. Capacitor injects one backed by `@capacitor/network`
     * so Android reads the native connectivity state instead of the WebView's
     * unreliable `navigator.onLine`; when omitted the app uses the browser
     * source (see {@link CreateNetworkStatusFn}).
     */
    readonly createNetworkStatus?: CreateNetworkStatusFn | undefined,
    /**
     * Reads the native build number (Android `versionCode` / iOS
     * `CFBundleVersion`) for the Environment tab. Only native shells inject one
     * (see {@link ReadNativeBuildNumberFn}); elsewhere the row stays unknown.
     */
    readonly readNativeBuildNumber?: ReadNativeBuildNumberFn | undefined,
    /**
     * File-saver capability backing the app's download action. Native WebView
     * shells inject one because the browser anchor download is a no-op there
     * (see {@link CreateFileSaverFn}); when omitted the app uses the browser
     * saver.
     */
    readonly createFileSaver?: CreateFileSaverFn | undefined,
    /**
     * Reuse one long-lived SQLite worker across identity/database switches
     * instead of tearing it down and constructing a new one (see
     * {@link AppHostConfigOptions.reuseDatabaseWorker}). Native WebView shells
     * set this; the web shell leaves it unset.
     */
    readonly reuseDatabaseWorker?: boolean | undefined,
    /**
     * Wrapping-key persistence mode for the local keyring (see
     * {@link AppHostConfigOptions.localKeyringKeyMaterialStorage}). WebView
     * shells set `"raw-bytes"`; the web shell leaves it unset.
     */
    readonly localKeyringKeyMaterialStorage?:
      | WrappingKeyMaterialStorage
      | undefined,
    /**
     * Native resume/transport-change signal. The events binding uses it to
     * replace a possibly half-open WebSocket and mint a fresh one-time ticket.
     */
    readonly subscribeConnectionRefresh?:
      | SubscribeConnectionRefreshFn
      | undefined,
    /** Native software-keyboard visibility for WebViews resized by the OS. */
    readonly subscribeKeyboardVisibility?:
      | SubscribeKeyboardVisibilityFn
      | undefined,
    readonly createScanner?: CreateScannerFn | undefined,
    /** Native document viewer for formats a WebView cannot render itself. */
    readonly createFileViewer?: CreateFileViewerFn | undefined,
    /**
     * Platform-aware subscription management. iOS supplies a StoreKit-backed
     * implementation for Apple subscriptions so sandbox testers do not get
     * sent through the production Media & Purchases account surface.
     */
    readonly openSubscriptionManagement?:
      | OpenSubscriptionManagementFn
      | undefined,
  ) {}

  /**
   * Returns a copy with key-presence semantics: spread copies explicit
   * `undefined`, letting callers reset fields like `localIdentityNamespace`
   * without repeating positional reconstruction at clone sites.
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
      createPurchases: this.createPurchases,
      buildInfo: this.buildInfo,
      createDirectCheckout: this.createDirectCheckout,
      createNetworkStatus: this.createNetworkStatus,
      readNativeBuildNumber: this.readNativeBuildNumber,
      createFileSaver: this.createFileSaver,
      reuseDatabaseWorker: this.reuseDatabaseWorker,
      localKeyringKeyMaterialStorage: this.localKeyringKeyMaterialStorage,
      subscribeConnectionRefresh: this.subscribeConnectionRefresh,
      subscribeKeyboardVisibility: this.subscribeKeyboardVisibility,
      createScanner: this.createScanner,
      createFileViewer: this.createFileViewer,
      openSubscriptionManagement: this.openSubscriptionManagement,
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
    options.createPurchases,
    options.buildInfo,
    options.createDirectCheckout,
    options.createNetworkStatus,
    options.readNativeBuildNumber,
    options.createFileSaver,
    options.reuseDatabaseWorker,
    options.localKeyringKeyMaterialStorage,
    options.subscribeConnectionRefresh,
    options.subscribeKeyboardVisibility,
    options.createScanner,
    options.createFileViewer,
    options.openSubscriptionManagement,
  );
}

export function resolveEventsWebSocketUrl(
  apiBaseUrl: string,
  configuredWsUrl?: string | undefined,
): string {
  const currentLocationHref = globalThis.location?.href ?? "http://localhost/";
  const base = currentLocationHref.replace(/^http/iu, "ws");

  if (configuredWsUrl) {
    return new URL(configuredWsUrl, base).toString();
  }

  const url = new URL(apiBaseUrl.replace(/^http/iu, "ws"), base);
  url.pathname = `${url.pathname.replace(/\/$/u, "")}/events`;
  return url.toString();
}

/**
 * Backend URL used when no target inlines one. Each shell resolves to this in
 * dev so `bun run dev` works against a local API with no env setup.
 */
const DEV_API_BASE_URL = "http://localhost:3001";

/** @public */
export interface AppHostRuntimeInput {
  /** Raw, possibly-unset backend URL inlined by the target's bundler. */
  readonly apiBaseUrl: string | undefined;
  /** Raw, possibly-unset websocket override; defaults to the events path of {@link apiBaseUrl}. */
  readonly wsUrl?: string | undefined;
}

/** @public */
export interface ResolvedAppHostRuntime {
  readonly apiBaseUrl: string;
  readonly wsUrl: string;
}

/**
 * The one place every platform shell turns its inlined env into the backend
 * `{ apiBaseUrl, wsUrl }` pair. The three targets each read env through a
 * different bundler — Vite `import.meta.env.VITE_*` for capacitor, `bun build
 * --env` for web and electrobun — so the raw read has to stay at each entry
 * point, but the *policy* (the shared dev default and the websocket derivation)
 * lives here so the targets cannot drift. It replaces three divergent inline
 * resolutions: capacitor threw on an unset URL, web fell back to localhost, and
 * electrobun hardcoded localhost with no way to point elsewhere.
 *
 * A blank value (bundlers emit `""` as often as `undefined` for an unset var)
 * collapses to the dev default. Release safety — refusing to ship a build aimed
 * at a laptop's LAN address like `10.0.1.10:8085` — is enforced at build time by
 * the store-release scripts (`scripts/*Release.sh`, via `releaseGuards.sh`)
 * and the fastlane `ensure_release_*_capacitor_sync!` server.url guards, not
 * here, because the web bundle is byte-identical across a capacitor debug and
 * release build and so cannot tell at runtime which one it is.
 */
export function resolveAppHostRuntimeConfig(
  input: AppHostRuntimeInput,
): ResolvedAppHostRuntime {
  const apiBaseUrl = (input.apiBaseUrl ?? "").trim() || DEV_API_BASE_URL;
  const configuredWsUrl = (input.wsUrl ?? "").trim() || undefined;
  return {
    apiBaseUrl,
    wsUrl: resolveEventsWebSocketUrl(apiBaseUrl, configuredWsUrl),
  };
}
