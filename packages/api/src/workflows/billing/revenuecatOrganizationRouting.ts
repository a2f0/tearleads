import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { and, eq, inArray } from "drizzle-orm";
import { resolveOrganizationIdFromEvent } from "../../billing/revenuecatWebhook";
import {
  canInferNativeBindingWithoutReceiptId,
  resolveRetainedNativeSubscriptionOrganizationForUser,
} from "./nativeSubscriptionResolution";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import type { ImmutableStripeStoreOrgResolution } from "./revenuecatStripeResolution";

type NativeOrganizationResolution =
  | { readonly kind: "ambiguous" }
  | { readonly kind: "blocked" }
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly organizationId: string };

function canBootstrapNativeBinding(type: string): boolean {
  return type === "INITIAL_PURCHASE" || type === "NON_RENEWING_PURCHASE";
}

async function resolveAppliedProductChangeOrganization(
  db: DatabaseSession,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  const productId = event.product_id;
  const store = event.store?.toUpperCase();
  if (!event.original_transaction_id || !productId || !store) {
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

async function resolvePlayProductChangeOrganization(
  db: DatabaseSession,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  if (event.store?.toUpperCase() !== "PLAY_STORE") {
    return { kind: "blocked" };
  }
  const sourceTier = getSyncBillingTierForNativeProduct(event.product_id);
  if (!sourceTier) return { kind: "blocked" };
  // Play replaces its purchase token during a plan change. Match the source
  // tier only among bindings whose exact current token has applied Play audit
  // lineage; buyer + tier alone can cross-route an App Store subscription.
  const candidates = await db
    .select({
      organizationId: organizationBilling.organizationId,
      productId: organizationBilling.providerProductId,
      subscriptionId: organizationBilling.providerSubscriptionId,
    })
    .from(organizationBilling)
    .where(
      and(
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerCustomerId, event.app_user_id),
        eq(organizationBilling.status, "active"),
      ),
    );
  const tierMatches = candidates.filter(
    (candidate) =>
      candidate.subscriptionId !== null &&
      getSyncBillingTierForNativeProduct(candidate.productId)?.id ===
        sourceTier.id,
  );
  const subscriptionIds = tierMatches.flatMap(({ subscriptionId }) =>
    subscriptionId ? [subscriptionId] : [],
  );
  if (subscriptionIds.length === 0) return { kind: "blocked" };
  const lineage = await db
    .select({
      organizationId: revenuecatWebhookEvents.organizationId,
      subscriptionId: revenuecatWebhookEvents.originalTransactionId,
    })
    .from(revenuecatWebhookEvents)
    .where(
      and(
        eq(revenuecatWebhookEvents.appUserId, event.app_user_id),
        eq(revenuecatWebhookEvents.outcome, "applied"),
        eq(revenuecatWebhookEvents.store, "PLAY_STORE"),
        inArray(revenuecatWebhookEvents.originalTransactionId, subscriptionIds),
      ),
    );
  const matching = tierMatches.filter((candidate) =>
    lineage.some(
      (entry) =>
        entry.organizationId === candidate.organizationId &&
        entry.subscriptionId === candidate.subscriptionId,
    ),
  );
  if (matching.length > 1) return { kind: "ambiguous" };
  return matching[0]
    ? { kind: "resolved", organizationId: matching[0].organizationId }
    : { kind: "blocked" };
}

async function resolveReceiptlessNativeOrganization(
  db: DatabaseSession,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  if (!canInferNativeBindingWithoutReceiptId(event.type)) {
    return canBootstrapNativeBinding(event.type)
      ? { kind: "none" }
      : { kind: "blocked" };
  }
  const retainedOrganizationId =
    await resolveRetainedNativeSubscriptionOrganizationForUser(
      db,
      event.app_user_id,
    );
  if (retainedOrganizationId === "ambiguous") return { kind: "ambiguous" };
  if (retainedOrganizationId) {
    return { kind: "resolved", organizationId: retainedOrganizationId };
  }
  return canBootstrapNativeBinding(event.type)
    ? { kind: "none" }
    : { kind: "blocked" };
}

async function resolveBoundNativeOrganization(
  db: DatabaseSession,
  event: RevenueCatWebhookEvent,
): Promise<NativeOrganizationResolution> {
  if (!isRecognizedNativeRevenueCatStore(event.store)) {
    return { kind: "none" };
  }
  if (!event.original_transaction_id) {
    return resolveReceiptlessNativeOrganization(db, event);
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
  if (event.type !== "PRODUCT_CHANGE") {
    if (canBootstrapNativeBinding(event.type)) return { kind: "none" };

    // An unmatched lifecycle receipt may still be checked safely against one
    // immutable retained binding. This never trusts the mutable orgId. When no
    // native binding exists, allow the normal bootstrap route so a delayed
    // lifecycle event is still stopped by Stripe/native conflict policy.
    const retainedOrganizationId =
      await resolveRetainedNativeSubscriptionOrganizationForUser(
        db,
        event.app_user_id,
      );
    if (retainedOrganizationId === "ambiguous") return { kind: "ambiguous" };
    return retainedOrganizationId
      ? { kind: "resolved", organizationId: retainedOrganizationId }
      : { kind: "none" };
  }
  return resolvePlayProductChangeOrganization(db, event);
}

export async function resolveRevenueCatWebhookOrganizationId(input: {
  readonly db: DatabaseSession;
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
  if (nativeResolution.kind !== "none") return null;
  // Native subscriber attributes are customer-level and mutable. They remain
  // only the bootstrap route before a receipt has a durable binding.
  return resolveOrganizationIdFromEvent(input.event);
}
