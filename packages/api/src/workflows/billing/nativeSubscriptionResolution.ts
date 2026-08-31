import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import { organizationBilling, users } from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import { and, eq } from "drizzle-orm";

export async function resolveActiveNativeSubscriptionOrganizationForUser(
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
  return recognizedNativeBindings[0]?.organizationId ?? null;
}

export async function resolveNativeSubscriptionOrganizationForUser(
  db: ApiDatabase,
  userId: string,
  subscriptionId?: string,
): Promise<string | null | "ambiguous"> {
  return db.transaction(async (tx) => {
    const resolved = await resolveActiveNativeSubscriptionOrganizationForUser(
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
