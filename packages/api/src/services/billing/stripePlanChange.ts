import {
  BILLING_ERROR_CODES,
  type SyncBillingTier,
} from "@tearleads/validators/billing";
import type { StripePlanChange } from "@tearleads/validators/response";
import {
  getStripeSyncOption,
  isStripeCheckoutConfigured,
  type StripeApiDeps,
  StripeApiError,
} from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";
import { upgradeSubscriptionPlan } from "../../billing/stripePlanUpgrade";
import { updateSubscriptionItemQuantity } from "../../billing/stripeSeatQuantity";
import {
  getSubscriptionBinding,
  type StripeSubscriptionBinding,
} from "../../billing/stripeSubscriptionBinding";
import { runResolveOrgSubscriptionForAdminWorkflow } from "../../workflows/billing/stripeCheckout";
import {
  type BegunStripePlanChange,
  runAbandonStripePlanUpgradeWorkflow,
  runBeginStripePlanChangeWorkflow,
  runFinishStripePlanUpgradeWorkflow,
  runReadStripePlanSubscriptionWorkflow,
  stripePlanChangeUnavailable,
} from "../../workflows/billing/stripePlanChange";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";
import type { StripeCheckoutServiceDeps } from "./stripeCheckoutConfiguration";

type BegunUpgrade = Extract<BegunStripePlanChange, { kind: "upgrade" }>;

interface UpgradeInput {
  readonly begun: BegunUpgrade;
  readonly organizationId: string;
  readonly plan: SyncBillingTier;
  readonly priceId: string;
  readonly runtime: ApiServiceRuntime;
  readonly stripe: StripeApiDeps;
}

/**
 * Changes an organization's active Stripe subscription from the plan at
 * `currentSeatCount` (the one the admin saw) to the plan with `priceId`
 * (workflows/billing/stripePlanChange.ts has the rules). A larger plan is
 * charged its prorated difference now and granted only once paid; a smaller
 * one is scheduled for renewal; the current plan cancels a scheduled change.
 * Null when Stripe is unconfigured.
 */
export async function changeStripePlan(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  request: { readonly currentSeatCount: number; readonly priceId: string },
  deps: StripeCheckoutServiceDeps = {},
): Promise<StripePlanChange | null> {
  const { priceId } = request;
  // Authorize before Stripe is contacted for the plan's Price.
  await runResolveOrgSubscriptionForAdminWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  const stripe = deps.stripe ?? {};
  if (!isStripeCheckoutConfigured(stripe)) {
    return null;
  }
  const plan = getSyncBillingTierForStripePrice(priceId, stripe);
  if (!plan || !(await getStripeSyncOption(plan.id, stripe))) {
    throw stripePlanChangeUnavailable("The plan is not offered");
  }
  const begun = await runBeginStripePlanChangeWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    {
      currentSeatCount: request.currentSeatCount,
      observed: await observeStripePlan(runtime, organizationId, stripe),
      plan,
    },
  );
  if (begun.kind !== "upgrade") {
    return begun.kind;
  }
  await upgrade({ begun, organizationId, plan, priceId, runtime, stripe });
  return "upgraded";
}

/**
 * The bound subscription's plan in Stripe, read before the change so a paid
 * upgrade not yet recorded is seen (the workflow's rules say why).
 */
async function observeStripePlan(
  runtime: ApiServiceRuntime,
  organizationId: string,
  stripe: StripeApiDeps,
) {
  const subscriptionId = await runReadStripePlanSubscriptionWorkflow(
    runtime.db,
    organizationId,
  );
  const binding = subscriptionId
    ? await getSubscriptionBinding(subscriptionId, stripe)
    : null;
  return subscriptionId && binding
    ? {
        billingPeriodStartsAt: binding.billingPeriodStartsAt,
        seatCount: binding.seatQuantity,
        subscriptionId,
      }
    : null;
}

/**
 * Pays for the upgrade, then grants it. A payment that did not go through
 * releases the change. A provider failure whose outcome is unknown keeps the
 * lease until it lapses rather than releasing it: Stripe may have applied the
 * upgrade, and a retry once the lease lapses finds it applied and grants it.
 */
async function upgrade(input: UpgradeInput): Promise<void> {
  // Nothing was written to Stripe before this read, so a failed read
  // releases the change.
  const binding = await getSubscriptionBinding(
    input.begun.subscriptionId,
    input.stripe,
  ).catch(async (error: unknown) => {
    await abandon(input);
    throw error;
  });
  if (!binding || !bindingMatchesBegun(input, binding)) {
    await abandon(input);
    throw stripePlanChangeUnavailable(
      "The Stripe subscription cannot be changed now; it may be renewing, so try again in a moment",
    );
  }
  // A retried upgrade whose payment settled after its first answer.
  const applied = binding.seatQuantity === input.plan.seatLimit;
  if (!applied && new Date() > input.begun.chargeBy) {
    await abandon(input);
    throw stripePlanChangeUnavailable(
      "The plan change took too long to start; try again",
    );
  }
  if (!applied && !(await charge(input, binding.seatQuantity ?? 0))) {
    await abandon(input);
    throw new OrganizationManagerError(
      "The payment for the larger plan did not go through; nothing changed",
      409,
      BILLING_ERROR_CODES.planChangePaymentFailed,
    );
  }
  await runFinishStripePlanUpgradeWorkflow(input.runtime.db, {
    leaseId: input.begun.leaseId,
    organizationId: input.organizationId,
    paidPeriodEndsAt: input.begun.paidPeriodEndsAt,
    plan: input.plan,
    priceId: input.priceId,
    subscriptionId: input.begun.subscriptionId,
  });
}

/**
 * Whether Stripe's subscription is still the one the upgrade began for, in
 * the period its capacity was paid for. After a renewal Stripe has already
 * charged a new period whose webhooks may not have arrived; charging from
 * the old period's capacity would then misprice the upgrade.
 */
function bindingMatchesBegun(
  input: UpgradeInput,
  binding: StripeSubscriptionBinding,
): boolean {
  const { begun } = input;
  return (
    binding.seatQuantity !== null &&
    binding.organizationId === input.organizationId &&
    binding.subscriptionItemId === begun.subscriptionItemId &&
    binding.status === "active" &&
    begun.paidPeriodStartsAt !== null &&
    begun.paidPeriodEndsAt !== null &&
    binding.billingPeriodStartsAt?.getTime() ===
      begun.paidPeriodStartsAt.getTime() &&
    binding.billingPeriodEndsAt?.getTime() === begun.paidPeriodEndsAt.getTime()
  );
}

/**
 * Charges the prorated difference from the capacity paid this period. A
 * scheduled smaller plan already lowered the item's Price, which Stripe would
 * prorate from, so the paid Price is restored first, without proration.
 */
async function charge(
  input: UpgradeInput,
  itemSeatQuantity: number,
): Promise<boolean> {
  const { begun, organizationId, stripe } = input;
  if (itemSeatQuantity < begun.paidCapacity) {
    await updateSubscriptionItemQuantity(
      {
        idempotencyKey: `plan-baseline:${organizationId}:${begun.leaseId}`,
        prorationBehavior: "none",
        seatQuantity: begun.paidCapacity,
        subscriptionItemId: begun.subscriptionItemId,
      },
      stripe,
    );
  }
  const outcome = await upgradeSubscriptionPlan(
    {
      idempotencyKey: `plan-upgrade:${organizationId}:${begun.leaseId}`,
      priceId: input.priceId,
      subscriptionId: begun.subscriptionId,
      subscriptionItemId: begun.subscriptionItemId,
    },
    stripe,
  );
  if (outcome === null) {
    throw new StripeApiError("subscription plan upgrade (unconfigured)", 502);
  }
  return outcome === "paid";
}

function abandon(input: UpgradeInput): Promise<void> {
  return runAbandonStripePlanUpgradeWorkflow(input.runtime.db, {
    leaseId: input.begun.leaseId,
    organizationId: input.organizationId,
  });
}
