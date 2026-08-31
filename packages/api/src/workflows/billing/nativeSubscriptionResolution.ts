import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import { and, eq } from "drizzle-orm";

export async function resolveNativeSubscriptionOrganizationForUser(
  db: ApiDatabase,
  userId: string,
  subscriptionId?: string,
): Promise<string | null | "ambiguous"> {
  return db.transaction(async (tx) => {
    const nativeBindings = await tx
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
          eq(organizationBilling.status, "active"),
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
    if (recognizedNativeBindings[0]) {
      return recognizedNativeBindings[0].organizationId;
    }

    const [user] = await tx
      .select({ organizationId: users.defaultOrganizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.organizationId ?? null;
  });
}
