import type {
  ApiDatabase,
  DatabaseSession,
} from "@tearleads/api-shared/postgres";
import { organizationBilling, users } from "@tearleads/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@tearleads/validators/billing";
import { and, eq, isNotNull } from "drizzle-orm";

const NATIVE_BINDING_CONTINUATION_EVENT_TYPES: ReadonlySet<string> = new Set([
  "EXPIRATION",
  "NON_RENEWING_PURCHASE",
  "RENEWAL",
  "SUBSCRIPTION_EXTENDED",
  "SUBSCRIPTION_PAUSED",
  "TEMPORARY_ENTITLEMENT_GRANT",
  "UNCANCELLATION",
]);

/** Whether a receipt-less event can safely continue one unique native binding. */
export function canInferNativeBindingWithoutReceiptId(type: string): boolean {
  return NATIVE_BINDING_CONTINUATION_EVENT_TYPES.has(type);
}

export async function resolveRetainedNativeSubscriptionOrganizationForUser(
  executor: DatabaseSession,
  userId: string,
  subscriptionId?: string,
): Promise<string | null | "ambiguous"> {
  const nativeBindings = await executor
    .select({
      organizationId: organizationBilling.organizationId,
      productId: organizationBilling.providerProductId,
      subscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerCustomerId, userId),
        isNotNull(organizationBilling.providerSubscriptionId),
      ),
    );
  const recognizedNativeBindings = nativeBindings.filter((binding) =>
    getSyncBillingTierForNativeProduct(binding.productId),
  );
  const exactBinding = subscriptionId
    ? recognizedNativeBindings.find(
        (binding) => binding.subscriptionId === subscriptionId,
      )
    : undefined;
  if (exactBinding) return exactBinding.organizationId;
  if (recognizedNativeBindings.length > 1) return "ambiguous";
  return recognizedNativeBindings[0]?.organizationId ?? null;
}

export async function resolveNativeSubscriptionOrganizationForUser(
  db: ApiDatabase,
  userId: string,
  subscriptionId?: string,
): Promise<string | null | "ambiguous"> {
  return db.transaction(async (tx) => {
    const resolved = await resolveRetainedNativeSubscriptionOrganizationForUser(
      tx,
      userId,
      subscriptionId,
    );
    if (resolved !== null) return resolved;

    const [user] = await tx
      .select({ organizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.organizationId ?? null;
  });
}
