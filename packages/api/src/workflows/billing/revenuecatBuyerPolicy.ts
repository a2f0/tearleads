import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";
import { eq } from "drizzle-orm";
import { requireDirectOrganizationAccess } from "../organizations/access";
import { OrganizationManagerError } from "../organizations/errors";

const NATIVE_REVENUECAT_STORES = new Set([
  "AMAZON",
  "APP_STORE",
  "MAC_APP_STORE",
  "PLAY_STORE",
  "TEST_STORE",
]);

/** Whether RevenueCat reports a device-store purchase subject to personal-org policy. */
export function isNativeRevenueCatStore(
  store: string | null | undefined,
): boolean {
  return NATIVE_REVENUECAT_STORES.has(store?.toUpperCase() ?? "UNKNOWN_STORE");
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
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
}): Promise<string | null> {
  if (isNativeRevenueCatStore(input.event.store)) {
    if (!isUuidV4String(input.event.app_user_id)) {
      return "Native purchase buyer is not a Tearleads user";
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
  if (input.currentProviderCustomerId === input.event.app_user_id) {
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
