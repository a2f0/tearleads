import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { revenuecatWebhookEvents, users } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { isUuidV4String } from "@symcrypt/validators/util";
import { and, eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

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
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<boolean> {
  const productId = input.event.product_id;
  const store = input.event.store?.toUpperCase();
  if (
    input.event.type !== "INITIAL_PURCHASE" ||
    !input.event.original_transaction_id ||
    !productId ||
    !store
  ) {
    return false;
  }
  const [change] = await input.executor
    .select({ id: revenuecatWebhookEvents.id })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.organizationId, input.organizationId),
        eq(revenuecatWebhookEvents.appUserId, input.event.app_user_id),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(
          revenuecatWebhookEvents.originalTransactionId,
          input.event.original_transaction_id,
        ),
        eq(revenuecatWebhookEvents.productId, productId),
        eq(revenuecatWebhookEvents.store, store),
      ),
    )
    .limit(1);
  return change !== undefined;
}

/** Returns the buyer-policy reason a paid grant must be ignored, if any. */
export async function resolveRevenueCatBuyerIgnoredReason(input: {
  readonly currentProviderCustomerId: string | null;
  readonly currentProviderProductId: string | null;
  readonly currentProviderSubscriptionId: string | null;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<string | null> {
  const sameProviderCustomer =
    input.currentProviderCustomerId === input.event.app_user_id;
  const isNativeStore = isNativeRevenueCatStore(input.event.store);
  if (isNativeStore) {
    // A verified receipt may continue outside the personal org after restore,
    // but buyer identity alone is not enough: one RevenueCat customer can own
    // multiple Apple/Play subscriptions. Require the exact durable receipt, or
    // the provider's preceding product-change event for a replacement Play
    // token. PRODUCT_CHANGE itself is separately checked against the locked
    // source tier before it reaches this policy.
    if (
      sameProviderCustomer &&
      getSyncBillingTierForNativeProduct(input.currentProviderProductId) &&
      input.currentProviderSubscriptionId &&
      (input.event.original_transaction_id ===
        input.currentProviderSubscriptionId ||
        input.event.type === "PRODUCT_CHANGE" ||
        (await hasPriorNativeProductChange(input)))
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
