/**
 * Client purchases capability for org **sync** billing through a native store.
 *
 * Sync is the single paid feature; a purchase is made on behalf of an
 * organization and ultimately drives the server RevenueCat webhook, which grants
 * the org's sync entitlement. This module keeps the capability provider-agnostic:
 * the {@link PurchasesCapability} interface is what the app consumes, the
 * injectable {@link RevenueCatBackend} is the minimal native surface a platform
 * shell wires up (`@revenuecat/purchases-capacitor`), and
 * {@link createUnavailablePurchases} is the stub for platforms without a store.
 * Web sells through the direct Stripe checkout instead and never loads a
 * RevenueCat SDK; RevenueCat's web role is server-side receipt mirroring.
 */

import {
  getSyncBillingTierForNativeProduct,
  type NativeSubscriptionStore,
  type SyncBillingTierId,
} from "@tearleads/validators/billing";
import { PurchasesUnavailableError } from "./purchaseErrors";
import {
  revenueCatCheckoutSettlementTimeoutMs,
  revenueCatOperationTimeoutMs,
} from "./revenueCatErrors";
import { createRevenueCatIdentityCoordinator } from "./revenueCatIdentity";
import { nativeMove } from "./revenueCatNativeSubscriptionMove";
import {
  normalizeRevenueCatCheckoutError,
  normalizeRevenueCatIdentityError,
} from "./revenueCatPurchaseErrorNormalization";
import { prepareRevenueCatPurchase } from "./revenueCatPurchasePreparation";

export {
  PurchaseAbortedError,
  PurchaseAlreadyOwnedError,
  PurchaseCancelledError,
  PurchaseIdentityPendingError,
  PurchaseProviderStalledError,
  PurchasesUnavailableError,
} from "./purchaseErrors";

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
 * implementation (Capacitor) or the {@link createUnavailablePurchases} stub;
 * callers gate purchase UI on {@link isAvailable}.
 */
export interface PurchasesCapability {
  /** False when purchasing is not supported on this platform (the stub). */
  readonly isAvailable: boolean;
  /** Native receipt store this capability can restore, or null off-device. */
  readonly nativeStore: NativeSubscriptionStore | null;
  /** Identify the buyer to the provider; the App User ID is the buyer's user id. */
  identify(input: { userId: string }): Promise<void>;
  /** Forget the identified buyer (e.g. on sign-out). */
  reset(): Promise<void>;
  /** Sync subscription options available to purchase. */
  listSyncOptions(): Promise<SyncSubscriptionOption[]>;
  /**
   * Purchase sync for one organization, binding the purchase to that org.
   * `abortSignal` lets the caller withdraw a purchase that has not reached the
   * store sheet yet — a presented sheet cannot be dismissed programmatically,
   * so the backend honors the abort only before it presents.
   */
  purchaseSync(input: {
    organizationId: string;
    packageId: string;
    abortSignal?: AbortSignal;
    /** Providers must call this synchronously when their UI becomes impossible to dismiss. */
    onProviderPresented?: () => void;
  }): Promise<SyncPurchaseResult>;
  /** Publish a server-accepted organization binding for later lifecycle events. */
  bindOrganization(input: { organizationId: string }): Promise<void>;
  /**
   * Restore, prepare a destination, server-claim, and bind a native receipt for
   * one buyer. Destination preparation starts only after receipt verification
   * and is outside the bounded server-claim phase.
   */
  moveNativeSubscription(input: {
    userId: string;
    prepareClaim: () => Promise<string | null>;
    claim: (
      organizationId: string,
      store: NativeSubscriptionStore,
    ) => Promise<boolean>;
  }): Promise<{ readonly organizationId: string }>;
  /** Whether the identified buyer currently holds the sync entitlement. */
  hasActiveSyncEntitlement(): Promise<boolean>;
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
  /** Resolve any provider data needed before buyer-controlled checkout begins. */
  preparePurchasePackage?(input: {
    packageId: string;
    abortSignal?: AbortSignal;
  }): Promise<unknown>;
  /**
   * `abortSignal` asks the backend to stop before presenting a store sheet the
   * caller has already abandoned; a presented sheet cannot be dismissed
   * programmatically once it is up.
   */
  purchasePackage(input: {
    packageId: string;
    abortSignal?: AbortSignal;
    preparedPurchase?: unknown;
    onProviderPresented?: () => void;
  }): Promise<RevenueCatCustomerInfo>;
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
  restorePurchases(): Promise<RevenueCatCustomerInfo>;
}

export interface RevenueCatPurchasesConfig {
  /** Provider SDK API key for this platform. */
  readonly apiKey: string;
  /** Entitlement id that grants sync (e.g. "sync"). */
  readonly syncEntitlementId: string;
  /** Store represented by this SDK key. */
  readonly nativeStore: NativeSubscriptionStore | null;
  /**
   * Whether restore uses the longer checkout-settlement deadline. Native
   * restores may wait for store authentication or billing-service reconnects.
   */
  readonly restorePurchasesUsesCheckoutTimeout: boolean;
  /**
   * Recovery deadline after native checkout or a long-running restore begins.
   * Defaults to ten minutes so normal buyer interaction remains unhurried while
   * a lost native callback eventually surfaces restart guidance.
   */
  readonly checkoutSettlementTimeoutMs?: number;
  /**
   * Subscriber attribute key that binds a purchase to an organization. The
   * server webhook reads this to resolve the org being paid for. Defaults to
   * "orgId".
   */
  readonly organizationAttributeKey?: string;
  /**
   * Maximum wait for provider setup, identity, and non-checkout operations.
   * Defaults to 30 seconds. Purchase checkout itself is not timed because the
   * native store sheet remains under the buyer's control. Native calls cannot
   * be cancelled, so timed-out work stays serialized. Later calls fail fast
   * until the bridge settles or the app restarts.
   */
  readonly operationTimeoutMs?: number;
}

function providerPresentedInput(callback: (() => void) | undefined) {
  return callback ? { onProviderPresented: callback } : {};
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

/**
 * Adapts a {@link RevenueCatBackend} into a {@link PurchasesCapability}. The
 * provider is configured lazily and exactly once (the first call that needs it),
 * so constructing the capability never touches the native SDK on its own.
 */
export function createRevenueCatPurchases(
  backend: RevenueCatBackend,
  config: RevenueCatPurchasesConfig,
): PurchasesCapability {
  const attributeKey =
    config.organizationAttributeKey ?? DEFAULT_ORGANIZATION_ATTRIBUTE_KEY;
  const identity = createRevenueCatIdentityCoordinator({
    apiKey: config.apiKey,
    backend,
    checkoutSettlementTimeoutMs: revenueCatCheckoutSettlementTimeoutMs(
      config.checkoutSettlementTimeoutMs,
    ),
    timeoutMs: revenueCatOperationTimeoutMs(config.operationTimeoutMs),
  });
  return {
    isAvailable: true,
    nativeStore: config.nativeStore,
    identify(input) {
      return identity
        .identify(input.userId)
        .catch(normalizeRevenueCatIdentityError);
    },
    reset: () => identity.reset().catch(normalizeRevenueCatIdentityError),
    async listSyncOptions() {
      const packages = await identity
        .runProviderOperation({
          operation: () => backend.getCurrentPackages(),
          operationName: "offerings",
          requiresKnownIdentity: false,
        })
        .catch(normalizeRevenueCatIdentityError);
      return packages.flatMap(toSyncSubscriptionOptions);
    },
    async purchaseSync(input) {
      // Identity changes wait until the store sheet settles: a presented
      // sheet cannot be dismissed, so its gate stays held until the result.
      let preparedPurchase: unknown;
      const info = await identity
        .runCheckout({
          ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
          operation: () =>
            backend.purchasePackage({
              packageId: input.packageId,
              ...(preparedPurchase === undefined ? {} : { preparedPurchase }),
              ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
              ...providerPresentedInput(input.onProviderPresented),
            }),
          // Bind inside the checkout gate so native events carry the org the
          // webhook resolves. A store purchase carries no transaction
          // metadata, so this mutable customer attribute is the binding.
          prepare: async () => {
            preparedPurchase = await prepareRevenueCatPurchase({
              abortSignal: input.abortSignal,
              attributes: {
                [attributeKey]: input.organizationId,
              },
              backend,
              packageId: input.packageId,
            });
          },
        })
        .catch(normalizeRevenueCatCheckoutError);
      return {
        syncEntitlementActive: holdsSyncEntitlement(
          info,
          config.syncEntitlementId,
        ),
      };
    },
    async bindOrganization(input) {
      await identity
        .runCustomerMutation({
          operation: () =>
            backend.setAttributes({
              [attributeKey]: input.organizationId,
            }),
          operationName: "organization binding",
        })
        .catch(normalizeRevenueCatIdentityError);
    },
    moveNativeSubscription: nativeMove(backend, config, identity, attributeKey),
    async hasActiveSyncEntitlement() {
      const info = await identity
        .runProviderOperation({
          operation: () => backend.getCustomerInfo(),
          operationName: "customer information",
        })
        .catch(normalizeRevenueCatIdentityError);
      return holdsSyncEntitlement(info, config.syncEntitlementId);
    },
  };
}

/**
 * The no-op purchases capability for platforms without a store (web and
 * desktop, or a Capacitor web preview). Read methods degrade quietly (no
 * options, no entitlement) so callers can query safely; only an actual
 * purchase attempt throws.
 */
export function createUnavailablePurchases(): PurchasesCapability {
  return {
    isAvailable: false,
    nativeStore: null,
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
    bindOrganization() {
      return Promise.reject(new PurchasesUnavailableError());
    },
    moveNativeSubscription() {
      return Promise.reject(new PurchasesUnavailableError());
    },
    hasActiveSyncEntitlement() {
      return Promise.resolve(false);
    },
  };
}
