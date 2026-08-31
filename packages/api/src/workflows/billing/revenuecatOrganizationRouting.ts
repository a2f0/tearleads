import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { and, eq } from "drizzle-orm";
import { resolveOrganizationIdFromEvent } from "../../billing/revenuecatWebhook";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import type { ImmutableStripeStoreOrgResolution } from "./revenuecatStripeResolution";

type NativeOrganizationResolution =
  | { readonly kind: "ambiguous" }
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly organizationId: string };

async function resolveAppliedProductChangeOrganization(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  const productId = event.product_id;
  const store = event.store?.toUpperCase();
  if (
    event.type !== "INITIAL_PURCHASE" ||
    !event.original_transaction_id ||
    !productId ||
    !store
  ) {
    return { kind: "none" };
  }
  const changes = await db
    .select({ organizationId: revenuecatWebhookEvents.organizationId })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.appUserId, event.app_user_id),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(
          revenuecatWebhookEvents.originalTransactionId,
          event.original_transaction_id,
        ),
        eq(revenuecatWebhookEvents.productId, productId),
        eq(revenuecatWebhookEvents.store, store),
      ),
    )
    .groupBy(revenuecatWebhookEvents.organizationId)
    .limit(2);
  const organizationIds = changes.flatMap(({ organizationId }) =>
    organizationId ? [organizationId] : [],
  );
  if (changes.length !== organizationIds.length || organizationIds.length > 1) {
    return { kind: "ambiguous" };
  }
  return organizationIds[0]
    ? { kind: "resolved", organizationId: organizationIds[0] }
    : { kind: "none" };
}

async function resolveBoundNativeOrganization(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  if (
    !isRecognizedNativeRevenueCatStore(event.store) ||
    !event.original_transaction_id
  ) {
    return { kind: "none" };
  }
  const [binding] = await db
    .select({ organizationId: organizationBilling.organizationId })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(
          organizationBilling.providerSubscriptionId,
          event.original_transaction_id,
        ),
      ),
    )
    .limit(1);
  if (binding) {
    return { kind: "resolved", organizationId: binding.organizationId };
  }
  const appliedChange = await resolveAppliedProductChangeOrganization(
    db,
    event,
  );
  if (appliedChange.kind !== "none") return appliedChange;
  if (event.type !== "PRODUCT_CHANGE") return { kind: "none" };

  const sourceTier = getSyncBillingTierForNativeProduct(event.product_id);
  if (!sourceTier) return { kind: "none" };
  // Play replaces its purchase token during a plan change. Before that token
  // has a durable binding, buyer + source tier is the only immutable route.
  // Multiple matches cannot be disambiguated by the mutable customer orgId.
  const candidates = await db
    .select({
      organizationId: organizationBilling.organizationId,
      productId: organizationBilling.providerProductId,
    })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerCustomerId, event.app_user_id),
        eq(organizationBilling.status, "active"),
      ),
    );
  const matching = candidates.filter(
    ({ productId }) =>
      getSyncBillingTierForNativeProduct(productId)?.id === sourceTier.id,
  );
  if (matching.length > 1) return { kind: "ambiguous" };
  return matching[0]
    ? { kind: "resolved", organizationId: matching[0].organizationId }
    : { kind: "none" };
}

export async function resolveRevenueCatWebhookOrganizationId(input: {
  readonly db: ApiDatabase;
  readonly event: RevenueCatWebhookEvent;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
}): Promise<string | null> {
  if (input.stripeResolution.kind === "resolved") {
    return input.stripeResolution.organizationId;
  }
  if (input.event.store?.toUpperCase() === "STRIPE") return null;
  const nativeResolution = await resolveBoundNativeOrganization(
    input.db,
    input.event,
  );
  if (nativeResolution.kind === "resolved") {
    return nativeResolution.organizationId;
  }
  if (nativeResolution.kind === "ambiguous") return null;
  // Native subscriber attributes are customer-level and mutable. They remain
  // only the bootstrap route before a receipt has a durable binding.
  return resolveOrganizationIdFromEvent(input.event);
}
