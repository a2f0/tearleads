import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { users } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { isUuidV4String } from "@symcrypt/validators/util";
import { eq } from "drizzle-orm";
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

/** Returns the buyer-policy reason a paid grant must be ignored, if any. */
export async function resolveRevenueCatBuyerIgnoredReason(input: {
  readonly currentProviderCustomerId: string | null;
  readonly currentProviderProductId: string | null;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<string | null> {
  const sameProviderCustomer =
    input.currentProviderCustomerId === input.event.app_user_id;
  const isNativeStore = isNativeRevenueCatStore(input.event.store);
  if (isNativeStore) {
    // A lifecycle event may continue an already-policy-checked native binding
    // after the buyer changes default context. A Stripe-associated customer is
    // not proof of native eligibility, and INITIAL_PURCHASE always rechecks.
    if (
      sameProviderCustomer &&
      input.event.type !== "INITIAL_PURCHASE" &&
      getSyncBillingTierForNativeProduct(input.currentProviderProductId)
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
