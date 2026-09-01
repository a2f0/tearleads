import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { isUuidV4String } from "@symcrypt/validators/util";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";
import { hasAcceptedPlayReplacement } from "./nativeSubscriptionIdentity";
import {
  canInferNativeBindingWithoutReceiptId,
  resolveRetainedNativeSubscriptionOrganizationForUser,
} from "./nativeSubscriptionResolution";
import type { VerifiedPlayReplacement } from "./revenuecatPlayReplacement";

const NON_NATIVE_REVENUECAT_STORES = new Set([
  "PROMOTIONAL",
  "RC_BILLING",
  "STRIPE",
]);
const RECOGNIZED_NATIVE_REVENUECAT_STORES = new Set([
  "APP_STORE",
  "PLAY_STORE",
  "TEST_STORE",
]);

/** Whether a provider value is safe to use as authority for native writes. */
export function isRecognizedNativeRevenueCatStore(
  store: string | null | undefined,
): boolean {
  return RECOGNIZED_NATIVE_REVENUECAT_STORES.has(store?.toUpperCase() ?? "");
}

/**
 * Whether a RevenueCat grant requires the restrictive personal-org policy.
 * Unknown and missing store values fail closed as native: only the explicitly
 * supported non-native lanes may bypass device-store restrictions.
 */
export function isNativeRevenueCatStore(
  store: string | null | undefined,
): boolean {
  return !NON_NATIVE_REVENUECAT_STORES.has(
    store?.toUpperCase() ?? "UNKNOWN_STORE",
  );
}

async function isOrganizationAdmin(
  executor: DatabaseSession,
  organizationId: string,
  userId: string,
): Promise<boolean> {
  try {
    await requireDirectOrganizationAccess({
      executor,
      organizationId,
      requireAdmin: true,
      userId,
    });
    return true;
  } catch (error) {
    if (error instanceof OrganizationManagerError) {
      return false;
    }
    throw error;
  }
}

async function hasPriorNativeProductChange(input: {
  readonly currentProviderSubscriptionId: string | null;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly verifiedReplacement?: VerifiedPlayReplacement | null | undefined;
}): Promise<boolean> {
  if (
    input.event.type !== "INITIAL_PURCHASE" &&
    input.event.type !== "RENEWAL"
  ) {
    return false;
  }
  return hasAcceptedPlayReplacement({
    appUserId: input.event.app_user_id,
    currentSubscriptionId: input.currentProviderSubscriptionId,
    executor: input.executor,
    organizationId: input.organizationId,
    productId: input.event.product_id ?? null,
    store: input.event.store ?? null,
    subscriptionId: input.event.original_transaction_id ?? null,
    verifiedReplacement: input.verifiedReplacement,
  });
}

/** Returns the buyer-policy reason a paid grant must be ignored, if any. */
export async function resolveRevenueCatBuyerIgnoredReason(input: {
  readonly currentProviderCustomerId: string | null;
  readonly currentProviderProductId: string | null;
  readonly currentProviderSubscriptionId: string | null;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly verifiedReplacement?: VerifiedPlayReplacement | null | undefined;
}): Promise<string | null> {
  const sameProviderCustomer =
    input.currentProviderCustomerId === input.event.app_user_id;
  const isNativeStore = isNativeRevenueCatStore(input.event.store);
  if (isNativeStore) {
    // A verified receipt may continue outside the personal org after restore,
    // but buyer identity alone is not enough: one RevenueCat customer can own
    // multiple Apple/Play subscriptions. Require the exact durable receipt, or
    // the provider's preceding product-change event for a replacement Play
    // token, or the unique retained binding when a continuation event omits the
    // receipt id. PRODUCT_CHANGE itself is separately checked against the
    // locked source tier before it reaches this policy.
    if (
      sameProviderCustomer &&
      getSyncBillingTierForNativeProduct(input.currentProviderProductId) &&
      input.currentProviderSubscriptionId &&
      (input.event.original_transaction_id ===
        input.currentProviderSubscriptionId ||
        (await hasPriorNativeProductChange(input)) ||
        (!input.event.original_transaction_id &&
          canInferNativeBindingWithoutReceiptId(input.event.type) &&
          (await resolveRetainedNativeSubscriptionOrganizationForUser(
            input.executor,
            input.event.app_user_id,
          )) === input.organizationId))
    ) {
      return null;
    }
    if (!isUuidV4String(input.event.app_user_id)) {
      return "Native purchase buyer is not a SymCrypt user";
    }
    const [buyer] = await input.executor
      .select({ defaultOrganizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, input.event.app_user_id))
      .limit(1);
    if (buyer?.defaultOrganizationId !== input.organizationId) {
      return "Native purchases may only fund the buyer's personal organization";
    }
  }
  if (sameProviderCustomer) {
    return null;
  }
  if (
    !isUuidV4String(input.event.app_user_id) ||
    !(await isOrganizationAdmin(
      input.executor,
      input.organizationId,
      input.event.app_user_id,
    ))
  ) {
    return "Buyer is not an organization admin";
  }
  return null;
}
