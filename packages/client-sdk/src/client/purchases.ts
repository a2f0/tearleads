/**
 * Client purchases capability for org **sync** billing.
 *
 * Sync is the single paid feature; a purchase is made on behalf of an
 * organization and ultimately drives the server RevenueCat webhook, which grants
 * the org's sync entitlement. This module keeps the capability provider-agnostic:
 * the {@link PurchasesCapability} interface is what the app consumes, the
 * injectable {@link RevenueCatBackend} is the minimal native surface a platform
 * shell wires up (e.g. `@revenuecat/purchases-capacitor`), and
 * {@link createUnavailablePurchases} is the stub for platforms without an
 * in-app-purchase provider.
 */

import {
  getSyncBillingTierForNativeProduct,
  type NativeSubscriptionStore,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";
import {
  createRevenueCatIdentityCoordinator,
  RevenueCatCheckoutAbandonedError,
  RevenueCatCheckoutIdentityPendingError,
  type RevenueCatIdentityCoordinator,
  RevenueCatOperationTimeoutError,
  revenueCatOperationTimeoutMs,
} from "./revenueCatIdentity";

/** A purchasable sync subscription option, shaped for display in billing UI. */
export interface SyncSubscriptionOption {
  /** Provider package identifier, passed back to {@link PurchasesCapability.purchaseSync}. */
  readonly packageId: string;
  /** Underlying store product identifier. */
  readonly productId: string;
  readonly title: string;
  readonly description: string;
  readonly tierId: SyncBillingTierId;
  readonly seatLimit: number;
  /** Localized, display-ready price (e.g. "$4.99"). */
  readonly priceLabel: string;
}

/** Outcome of a completed sync purchase. */
export interface SyncPurchaseResult {
  /** Whether the buyer now holds the sync entitlement. */
  readonly syncEntitlementActive: boolean;
}

/**
 * The purchases surface the app consumes. A platform either provides a real
 * implementation (Capacitor / Web Billing) or the {@link createUnavailablePurchases}
 * stub; callers gate purchase UI on {@link isAvailable}.
 */
export interface PurchasesCapability {
  /** False when purchasing is not supported on this platform (the stub). */
  readonly isAvailable: boolean;
  /** Native receipt store this capability can restore, or null off-device. */
  readonly nativeStore: NativeSubscriptionStore | null;
  /**
   * True when {@link purchaseSync}'s `checkoutHost` embeds a checkout this
   * platform can actually cancel from the app's own UI (Web Billing). Absent
   * or false on platforms whose checkout is a native sheet with its own
   * dismissal — billing UI uses this to decide whether to offer an in-app
   * Cancel affordance.
   */
  readonly supportsEmbeddedCheckout?: boolean;
  /** Identify the buyer to the provider; the App User ID is the buyer's user id. */
  identify(input: { userId: string }): Promise<void>;
  /** Forget the identified buyer (e.g. on sign-out). */
  reset(): Promise<void>;
  /** Sync subscription options available to purchase. */
  listSyncOptions(): Promise<SyncSubscriptionOption[]>;
  /**
   * Purchase sync for one organization, binding the purchase to that org.
   * `checkoutHost` optionally embeds the provider's checkout UI inside the
   * given element instead of a full-page overlay; providers whose checkout is
   * native (Capacitor) ignore it. `abortSignal` lets the caller withdraw a
   * purchase that has not reached the provider checkout yet — an embedded
   * checkout has no provider-side close control, so once the caller has
   * dismissed its own UI the backend must not mount a new checkout for a flow
   * nobody can see.
   */
  purchaseSync(input: {
    organizationId: string;
    packageId: string;
    checkoutHost?: HTMLElement;
    abortSignal?: AbortSignal;
  }): Promise<SyncPurchaseResult>;
  /** Restore prior purchases from the signed-in native store account. */
  restore(): Promise<SyncPurchaseResult>;
  /** Publish a server-accepted personal-org binding for later lifecycle events. */
  bindOrganization(input: { organizationId: string }): Promise<void>;
  /** Whether the identified buyer currently holds the sync entitlement. */
  hasActiveSyncEntitlement(): Promise<boolean>;
}

/** Thrown when a purchase is attempted on a platform without a purchases provider. */
export class PurchasesUnavailableError extends Error {
  constructor(message = "Purchases are not available on this platform") {
    super(message);
    this.name = "PurchasesUnavailableError";
  }
}

/**
 * Thrown when the buyer dismisses the provider checkout without completing the
 * purchase. Callers should treat it as a no-op, not a failure.
 */
export class PurchaseCancelledError extends Error {
  constructor(message = "The purchase was cancelled") {
    super(message);
    this.name = "PurchaseCancelledError";
  }
}

/** The store account already owns this subscription; offer restore/move. */
export class PurchaseAlreadyOwnedError extends Error {
  constructor(message = "This store account already owns the subscription") {
    super(message);
    this.name = "PurchaseAlreadyOwnedError";
  }
}

/**
 * A {@link PurchaseCancelledError} raised before any checkout UI mounted —
 * the purchase was abandoned (aborted) while still preparing. Distinct from
 * the base class so callers can tell "nothing ever existed on screen" apart
 * from a mounted checkout that was cancelled and torn down.
 */
export class PurchaseAbortedError extends PurchaseCancelledError {
  constructor(message = "The purchase was abandoned before checkout") {
    super(message);
    this.name = "PurchaseAbortedError";
  }
}

/** Checkout could not start because the provider identity is still changing. */
export class PurchaseIdentityPendingError extends Error {
  constructor(cause?: unknown) {
    super("RevenueCat identity or provider queue has not settled", { cause });
    this.name = "PurchaseIdentityPendingError";
  }
}

/** Provider bridge stopped responding; the app must be restarted before retrying. */
export class PurchaseProviderStalledError extends Error {
  constructor(cause?: unknown) {
    super("RevenueCat provider bridge stopped responding", { cause });
    this.name = "PurchaseProviderStalledError";
  }
}

/** A normalized purchasable package as returned by {@link RevenueCatBackend.getOfferings}. */
export interface RevenueCatPackage {
  readonly identifier: string;
  readonly productIdentifier: string;
  readonly title: string;
  readonly description: string;
  readonly priceString: string;
}

/** Normalized RevenueCat customer state — only the active entitlement ids are consumed. */
export interface RevenueCatCustomerInfo {
  readonly activeEntitlementIds: readonly string[];
}

/**
 * The minimal RevenueCat surface a platform shell adapts from its native SDK.
 * Keeping it normalized (plain ids/strings, no native types) lets the mapping in
 * {@link createRevenueCatPurchases} be unit-tested with a fake backend and keeps
 * `@tearleads/client-sdk` free of any provider dependency.
 */
export interface RevenueCatBackend {
  configure(input: { apiKey: string; appUserId?: string }): Promise<void>;
  logIn(input: { appUserId: string }): Promise<void>;
  logOut(): Promise<void>;
  setAttributes(attributes: Record<string, string | null>): Promise<void>;
  getCurrentPackages(): Promise<RevenueCatPackage[]>;
  /**
   * `htmlTarget` embeds the provider checkout in the given element (Web
   * Billing); backends with a native checkout ignore it, as they do
   * `metadata`, which is attached to the provider transaction itself (Web
   * Billing only). `abortSignal` asks the backend to stop before presenting a
   * checkout the caller has already abandoned — honored by every backend,
   * since neither an embedded widget nor a native store sheet can be
   * dismissed programmatically once it is up.
   */
  purchasePackage(input: {
    packageId: string;
    htmlTarget?: HTMLElement;
    metadata?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<RevenueCatCustomerInfo>;
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
  restorePurchases(): Promise<RevenueCatCustomerInfo>;
}

export interface RevenueCatPurchasesConfig {
  /** Provider SDK API key for this platform. */
  readonly apiKey: string;
  /** Entitlement id that grants sync (e.g. "sync"). */
  readonly syncEntitlementId: string;
  /** Store represented by this SDK key; null for Web Billing. */
  readonly nativeStore: NativeSubscriptionStore | null;
  /**
   * Whether this platform may start RevenueCat purchases. Defaults to true.
   * Set false when RevenueCat is retained only for entitlement observation.
   */
  readonly purchasesEnabled?: boolean;
  /**
   * Subscriber attribute key that binds a purchase to an organization. The
   * server webhook reads this to resolve the org being paid for. Defaults to
   * "orgId".
   */
  readonly organizationAttributeKey?: string;
  /**
   * Whether this platform's backend honors `checkoutHost` with a cancellable
   * embedded checkout (Web Billing). Defaults to false — native store sheets
   * carry their own dismissal.
   */
  readonly supportsEmbeddedCheckout?: boolean;
  /**
   * Maximum wait for provider setup, identity, and non-checkout operations.
   * Defaults to 30 seconds. Purchase checkout itself is not timed because the
   * native store sheet remains under the buyer's control. Native calls cannot
   * be cancelled, so timed-out work stays serialized. Later calls fail fast
   * until the bridge settles or the app restarts.
   */
  readonly operationTimeoutMs?: number;
}

const DEFAULT_ORGANIZATION_ATTRIBUTE_KEY = "orgId";

function holdsSyncEntitlement(
  info: RevenueCatCustomerInfo,
  entitlementId: string,
): boolean {
  return (
    Array.isArray(info?.activeEntitlementIds) &&
    info.activeEntitlementIds.includes(entitlementId)
  );
}

function toSyncSubscriptionOptions(
  entry: RevenueCatPackage,
): SyncSubscriptionOption[] {
  const tier = getSyncBillingTierForNativeProduct(entry.productIdentifier);
  return tier
    ? [
        {
          packageId: entry.identifier,
          productId: entry.productIdentifier,
          title: tier.title,
          description: entry.description,
          priceLabel: entry.priceString,
          tierId: tier.id,
          seatLimit: tier.seatLimit,
        },
      ]
    : [];
}

function requirePurchasesEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new PurchasesUnavailableError(
      "RevenueCat purchases are disabled on this platform",
    );
  }
}

function normalizeRevenueCatCheckoutError(error: unknown): never {
  if (error instanceof RevenueCatCheckoutAbandonedError) {
    throw new PurchaseAbortedError();
  }
  if (error instanceof RevenueCatCheckoutIdentityPendingError) {
    throw new PurchaseIdentityPendingError(error);
  }
  if (error instanceof RevenueCatOperationTimeoutError) {
    throwPurchaseTimeoutError(error);
  }
  throw error;
}

function normalizeRevenueCatIdentityError(error: unknown): never {
  if (error instanceof RevenueCatOperationTimeoutError) {
    throwPurchaseTimeoutError(error);
  }
  throw error;
}

function throwPurchaseTimeoutError(
  error: RevenueCatOperationTimeoutError,
): never {
  throw error.restartRequired
    ? new PurchaseProviderStalledError(error)
    : new PurchaseIdentityPendingError(error);
}

function runRevenueCatCustomerOperation<T>(input: {
  readonly buyerPaced?: boolean;
  readonly identity: RevenueCatIdentityCoordinator;
  readonly operation: () => Promise<T>;
  readonly operationName: string;
}): Promise<T> {
  return input.identity
    .runProviderOperation({
      ...(input.buyerPaced ? { buyerPaced: true } : {}),
      operation: input.operation,
      operationName: input.operationName,
    })
    .catch(normalizeRevenueCatIdentityError);
}

function listRevenueCatOptions(
  identity: RevenueCatIdentityCoordinator,
  backend: RevenueCatBackend,
): Promise<RevenueCatPackage[]> {
  return identity
    .runProviderOperation({
      operation: () => backend.getCurrentPackages(),
      operationName: "offerings",
      requiresKnownIdentity: false,
    })
    .catch(normalizeRevenueCatIdentityError);
}

async function prepareRevenueCatPurchase(input: {
  readonly abortSignal: AbortSignal | undefined;
  readonly attributes: Record<string, string>;
  readonly backend: RevenueCatBackend;
}): Promise<void> {
  try {
    await input.backend.setAttributes(input.attributes);
  } catch (error) {
    if (input.abortSignal?.aborted) throw new PurchaseAbortedError();
    throw error;
  }
}

/**
 * Adapts a {@link RevenueCatBackend} into a {@link PurchasesCapability}. The
 * provider is configured lazily and exactly once (the first call that needs it),
 * so constructing the capability never touches the native SDK on its own.
 */
export function createRevenueCatPurchases(
  backend: RevenueCatBackend,
  config: RevenueCatPurchasesConfig,
): PurchasesCapability {
  const purchasesEnabled = config.purchasesEnabled ?? true;
  const organizationAttributeKey =
    config.organizationAttributeKey ?? DEFAULT_ORGANIZATION_ATTRIBUTE_KEY;
  const operationTimeoutMs = revenueCatOperationTimeoutMs(
    config.operationTimeoutMs,
  );
  const identity = createRevenueCatIdentityCoordinator({
    apiKey: config.apiKey,
    backend,
    timeoutMs: operationTimeoutMs,
  });
  // Defensive against a backend that returns a malformed customer info despite
  // the typed contract (native bridges can hand back partial objects). Optional
  // chaining alone is insufficient: a non-array truthy `activeEntitlementIds`
  // would make `.includes` a TypeError, so gate on an actual array.
  return {
    isAvailable: purchasesEnabled,
    nativeStore: config.nativeStore,
    supportsEmbeddedCheckout:
      purchasesEnabled && (config.supportsEmbeddedCheckout ?? false),
    identify(input) {
      return identity
        .identify(input.userId)
        .catch(normalizeRevenueCatIdentityError);
    },
    reset: () => identity.reset().catch(normalizeRevenueCatIdentityError),
    async listSyncOptions() {
      if (!purchasesEnabled) return [];
      const packages = await listRevenueCatOptions(identity, backend);
      return packages.flatMap(toSyncSubscriptionOptions);
    },
    async purchaseSync(input) {
      requirePurchasesEnabled(purchasesEnabled);
      // A dismissed web checkout can remain unsettled on an isolated SDK
      // instance, so it must not hold provider reads or block a replacement.
      // Identity changes wait until checkout settles or the caller abandons
      // it; the web backend isolates an abandoned provider instance.
      const info = await identity
        .runCheckout({
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          operation: () =>
            backend.purchasePackage({
              packageId: input.packageId,
              // Web metadata is immutable per transaction. Native backends
              // ignore it and use the customer attribute prepared above.
              metadata: { [organizationAttributeKey]: input.organizationId },
              ...(input.checkoutHost ? { htmlTarget: input.checkoutHost } : {}),
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
            }),
          // Bind inside the checkout gate so native events carry the org the
          // webhook resolves. Web metadata is immutable per transaction;
          // native stores continue to rely on this mutable customer attribute.
          prepare: () =>
            prepareRevenueCatPurchase({
              abortSignal: input.abortSignal,
              attributes: {
                [organizationAttributeKey]: input.organizationId,
              },
              backend,
            }),
        })
        .catch(normalizeRevenueCatCheckoutError);
      return {
        syncEntitlementActive: holdsSyncEntitlement(
          info,
          config.syncEntitlementId,
        ),
      };
    },
    async restore() {
      requirePurchasesEnabled(purchasesEnabled);
      const info = await runRevenueCatCustomerOperation({
        // App Store restore may show buyer-controlled Apple sign-in UI. Google
        // Play restore has no equivalent sheet, so bound it like any other
        // bridge call instead of leaving an Android spinner up forever.
        buyerPaced: config.nativeStore === "app_store",
        identity,
        operation: () => backend.restorePurchases(),
        operationName: "restore",
      });
      return {
        syncEntitlementActive: holdsSyncEntitlement(
          info,
          config.syncEntitlementId,
        ),
      };
    },
    async bindOrganization(input) {
      requirePurchasesEnabled(purchasesEnabled);
      await runRevenueCatCustomerOperation({
        identity,
        operation: () =>
          backend.setAttributes({
            [organizationAttributeKey]: input.organizationId,
          }),
        operationName: "organization binding",
      });
    },
    async hasActiveSyncEntitlement() {
      const info = await runRevenueCatCustomerOperation({
        identity,
        operation: () => backend.getCustomerInfo(),
        operationName: "customer information",
      });
      return holdsSyncEntitlement(info, config.syncEntitlementId);
    },
  };
}

/**
 * The no-op purchases capability for platforms without an in-app-purchase
 * provider (web/desktop until Web Billing lands, or a Capacitor web preview).
 * Read methods degrade quietly (no options, no entitlement) so callers can query
 * safely; only an actual purchase attempt throws.
 */
export function createUnavailablePurchases(): PurchasesCapability {
  return {
    isAvailable: false,
    nativeStore: null,
    supportsEmbeddedCheckout: false,
    identify() {
      return Promise.resolve();
    },
    reset() {
      return Promise.resolve();
    },
    listSyncOptions() {
      return Promise.resolve([]);
    },
    purchaseSync() {
      return Promise.reject(new PurchasesUnavailableError());
    },
    restore() {
      return Promise.resolve({ syncEntitlementActive: false });
    },
    bindOrganization() {
      return Promise.reject(new PurchasesUnavailableError());
    },
    hasActiveSyncEntitlement() {
      return Promise.resolve(false);
    },
  };
}
