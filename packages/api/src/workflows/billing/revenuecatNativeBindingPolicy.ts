import type { DatabaseSession } from "@symcrypt/api-shared/postgres";
import { getSyncBillingTierForNativeProduct } from "@symcrypt/validators/billing";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import type { RevenueCatBillingTransition } from "../../billing/revenuecatWebhook";
import {
  matchesLockedNativeStore,
  matchesLockedNativeSubscription,
} from "./nativeSubscriptionIdentity";
import { isNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import {
  isNativePurchaseEventType,
  resolveNativeStripeConflictReason,
} from "./revenuecatProviderConflict";
import type { LockedBillingIdentity } from "./revenuecatStripeResolution";

const NATIVE_EVENT_CONFLICTS_WITH_EXISTING_SUBSCRIPTION_REASON =
  "Native event conflicts with an existing native subscription";
const NATIVE_PURCHASE_MISSING_SUBSCRIPTION_REASON =
  "Native purchase is missing a subscription identifier";

type NativeGrantDisposition =
  | {
      kind: "continue";
      deleteStripeBinding: false;
      ignoredReason: null;
      preserveStripeBinding: boolean;
      skipSeatReconciliation: boolean;
      transition: RevenueCatBillingTransition;
      warning: string | null;
    }
  | { kind: "retry"; reason: string };

function hasLiveNativeBinding(
  billing: LockedBillingIdentity | undefined,
): boolean {
  const statusCanBill =
    billing?.status === "active" ||
    billing?.status === "past_due" ||
    billing?.status === "trialing";
  return Boolean(
    statusCanBill &&
      billing.provider === "revenuecat" &&
      billing.providerSubscriptionId &&
      getSyncBillingTierForNativeProduct(billing.providerProductId),
  );
}

export async function resolveNativeProductChangeConflict(input: {
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string | null;
  readonly transition: RevenueCatBillingTransition;
}): Promise<string | null> {
  if (input.transition.kind !== "schedule") return null;
  if (!input.billing || !input.organizationId) {
    return NATIVE_EVENT_CONFLICTS_WITH_EXISTING_SUBSCRIPTION_REASON;
  }
  const matchesStore = await matchesLockedNativeStore({
    billing: input.billing,
    event: input.event,
    executor: input.executor,
    organizationId: input.organizationId,
  });
  const matchesToken =
    input.event.store?.toUpperCase() === "PLAY_STORE" ||
    input.billing.providerSubscriptionId ===
      input.event.original_transaction_id;
  return matchesStore && matchesToken
    ? null
    : NATIVE_EVENT_CONFLICTS_WITH_EXISTING_SUBSCRIPTION_REASON;
}

export async function resolveNativeGrantDisposition(input: {
  readonly billing: LockedBillingIdentity | undefined;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string | null;
  readonly skipSeatReconciliation: boolean;
  readonly transition: RevenueCatBillingTransition;
  readonly warning: string | null;
}): Promise<NativeGrantDisposition> {
  const nativeStripeConflict =
    input.transition.kind === "grant" && input.organizationId && input.billing
      ? await resolveNativeStripeConflictReason({
          billing: input.billing,
          executor: input.executor,
          now: input.now,
          organizationId: input.organizationId,
          store: input.event.store,
        })
      : null;
  const matchesNativeLifecycle =
    input.billing !== undefined &&
    input.organizationId !== null &&
    (await matchesLockedNativeSubscription({
      billing: input.billing,
      event: input.event,
      executor: input.executor,
      organizationId: input.organizationId,
    }));
  const nativeBindingConflict =
    input.transition.kind === "grant" &&
    hasLiveNativeBinding(input.billing) &&
    !matchesNativeLifecycle;
  const tokenlessNativePurchase =
    input.transition.kind === "grant" &&
    isNativeRevenueCatStore(input.event.store) &&
    isNativePurchaseEventType(input.event.type) &&
    !input.event.original_transaction_id &&
    !matchesNativeLifecycle;
  const nativeRevokeConflict =
    input.transition.kind === "revoke" &&
    isNativeRevenueCatStore(input.event.store) &&
    !matchesNativeLifecycle;
  const conflictReason = tokenlessNativePurchase
    ? NATIVE_PURCHASE_MISSING_SUBSCRIPTION_REASON
    : nativeBindingConflict || nativeRevokeConflict
      ? NATIVE_EVENT_CONFLICTS_WITH_EXISTING_SUBSCRIPTION_REASON
      : nativeStripeConflict;
  if (
    conflictReason !== null &&
    (nativeBindingConflict ||
      isNativePurchaseEventType(input.event.type) ||
      !matchesNativeLifecycle)
  ) {
    console.error(
      `RevenueCat paid grant ${input.event.id} was not applied: ${conflictReason}`,
    );
    return { kind: "retry", reason: conflictReason };
  }
  return {
    deleteStripeBinding: false,
    ignoredReason: null,
    kind: "continue",
    preserveStripeBinding: nativeStripeConflict !== null,
    skipSeatReconciliation:
      input.skipSeatReconciliation || nativeStripeConflict !== null,
    transition: input.transition,
    warning:
      [input.warning, nativeStripeConflict]
        .filter((reason): reason is string => reason !== null)
        .join("; ") || null,
  };
}
