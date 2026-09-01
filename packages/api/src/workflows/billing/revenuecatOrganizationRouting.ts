import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { and, eq, isNull, or } from "drizzle-orm";
import { resolveOrganizationIdFromEvent } from "../../billing/revenuecatWebhook";
import {
  canInferNativeBindingWithoutReceiptId,
  resolveRetainedNativeSubscriptionOrganizationForUser,
} from "./nativeSubscriptionResolution";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import {
  matchesVerifiedPlayReplacement,
  type VerifiedPlayReplacement,
} from "./revenuecatPlayReplacement";
import type { ImmutableStripeStoreOrgResolution } from "./revenuecatStripeResolution";

type NativeOrganizationResolution =
  | { readonly kind: "ambiguous" }
  | { readonly kind: "blocked" }
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly organizationId: string };

function canBootstrapNativeBinding(type: string): boolean {
  return type === "INITIAL_PURCHASE" || type === "NON_RENEWING_PURCHASE";
}

function canSettlePlayReplacement(type: string): boolean {
  return type === "INITIAL_PURCHASE" || type === "RENEWAL";
}

async function resolveAcceptedPlayProductChangeOrganization(
  db: DatabaseSession,
  event: RevenueCatWebhookEvent,
  verifiedReplacement: VerifiedPlayReplacement | null,
): Promise<NativeOrganizationResolution> {
  const productId = event.product_id;
  const store = event.store?.toUpperCase();
  if (
    !canSettlePlayReplacement(event.type) ||
    !event.original_transaction_id ||
    !productId ||
    store !== "PLAY_STORE" ||
    !verifiedReplacement ||
    !matchesVerifiedPlayReplacement(verifiedReplacement, {
      appUserId: event.app_user_id,
      organizationId: verifiedReplacement.organizationId,
      predecessorSubscriptionId: verifiedReplacement.predecessorSubscriptionId,
      productId,
      replacementSubscriptionId: event.original_transaction_id,
    })
  ) {
    return { kind: "none" };
  }
  // RevenueCat's Play PRODUCT_CHANGE identifies the existing purchase token,
  // not the replacement token. Route an effective event only through a marker
  // that was accepted against the organization's still-current predecessor.
  const changes = await db
    .select({ organizationId: revenuecatWebhookEvents.organizationId })
    .from(revenuecatWebhookEvents)
    .innerJoin(
      organizationBilling,
      and(
        eq(
          organizationBilling.organizationId,
          revenuecatWebhookEvents.organizationId,
        ),
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerCustomerId, event.app_user_id),
        eq(
          organizationBilling.providerSubscriptionId,
          revenuecatWebhookEvents.sourceOriginalTransactionId,
        ),
      ),
    )
    .where(
      and(
        eq(revenuecatWebhookEvents.appUserId, event.app_user_id),
        eq(
          revenuecatWebhookEvents.organizationId,
          verifiedReplacement.organizationId,
        ),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(
          revenuecatWebhookEvents.originalTransactionId,
          revenuecatWebhookEvents.sourceOriginalTransactionId,
        ),
        eq(
          revenuecatWebhookEvents.sourceOriginalTransactionId,
          verifiedReplacement.predecessorSubscriptionId,
        ),
        eq(revenuecatWebhookEvents.store, "PLAY_STORE"),
        or(
          and(
            eq(revenuecatWebhookEvents.outcome, "applied"),
            eq(revenuecatWebhookEvents.productId, productId),
          ),
          and(
            eq(revenuecatWebhookEvents.outcome, "ignored"),
            isNull(revenuecatWebhookEvents.productId),
          ),
        ),
      ),
    )
    .groupBy(revenuecatWebhookEvents.organizationId)
    .limit(1);
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
  verifiedReplacement: VerifiedPlayReplacement | null,
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
  const appliedChange = await resolveAcceptedPlayProductChangeOrganization(
    db,
    event,
    verifiedReplacement,
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
  // An unmatched PRODUCT_CHANGE has no verified predecessor and cannot be
  // associated using mutable customer attributes, buyer identity, or tier.
  return { kind: "blocked" };
}

export async function resolveRevenueCatWebhookOrganizationId(input: {
  readonly db: DatabaseSession;
  readonly event: RevenueCatWebhookEvent;
  readonly stripeResolution: ImmutableStripeStoreOrgResolution;
  readonly verifiedReplacement?: VerifiedPlayReplacement | null;
}): Promise<string | null> {
  if (input.stripeResolution.kind === "resolved") {
    return input.stripeResolution.organizationId;
  }
  if (input.event.store?.toUpperCase() === "STRIPE") return null;
  const nativeResolution = await resolveBoundNativeOrganization(
    input.db,
    input.event,
    input.verifiedReplacement ?? null,
  );
  if (nativeResolution.kind === "resolved") {
    return nativeResolution.organizationId;
  }
  if (nativeResolution.kind !== "none") return null;
  // Native subscriber attributes are customer-level and mutable. They remain
  // only the bootstrap route before a receipt has a durable binding.
  return resolveOrganizationIdFromEvent(input.event);
}
