import { isUuidV4String } from "@tearleads/validators/util";
import {
  associateStripeSubscription,
  isRevenueCatAssociationConfigured,
  type RevenueCatAssociationDeps,
} from "../../billing/revenueCatStripeAssociation";
import {
  createPortalSession,
  createSyncSubscription,
  findOrCreateCustomer,
  getStripeSyncOption,
  getSubscriptionBinding,
  isStripeCheckoutConfigured,
  type StripeApiDeps,
  type StripeCheckoutIntent,
  type StripeSyncOption,
} from "../../billing/stripeApi";
import {
  extractPaidSubscriptionId,
  readStripeWebhookSecret,
  verifyStripeSignature,
} from "../../billing/stripeWebhook";
import {
  runRequireBillingAdminWorkflow,
  runRequireCheckoutEligibleWorkflow,
} from "../../workflows/billing/stripeCheckout";
import type { ApiServiceRuntime } from "../runtime";

/**
 * Direct Stripe checkout services (issue #1654). The org-admin gate runs
 * first on every user-facing operation; Stripe/RevenueCat calls go through
 * the injectable clients so routes stay unit-testable.
 */

interface StripeCheckoutServiceDeps {
  readonly stripe?: StripeApiDeps;
  readonly revenueCat?: RevenueCatAssociationDeps;
}

/**
 * Checkout may only be offered when the WHOLE Stripe-to-RevenueCat flow is
 * configured. With only the Stripe half present a buyer could be charged for
 * a subscription the webhook can never associate — no entitlement would ever
 * be granted — so a partial configuration reads as "not configured".
 */
function isDirectCheckoutFullyConfigured(
  deps: StripeCheckoutServiceDeps,
): boolean {
  const stripeEnv = deps.stripe?.env ?? process.env;
  const revenueCatEnv = deps.revenueCat?.env ?? process.env;
  return (
    isStripeCheckoutConfigured(deps.stripe ?? {}) &&
    readStripeWebhookSecret(stripeEnv) !== null &&
    isRevenueCatAssociationConfigured(revenueCatEnv)
  );
}

/** Options are empty (not an error) when the integration is unconfigured. */
export async function getStripeCheckoutOptions(
  deps: StripeCheckoutServiceDeps = {},
): Promise<{ options: StripeSyncOption[] }> {
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return { options: [] };
  }
  const option = await getStripeSyncOption(deps.stripe ?? {});
  return { options: option ? [option] : [] };
}

/**
 * Creates the incomplete subscription for the org and returns what the
 * Payment Element needs. Null when the integration is unconfigured (route:
 * 503) — a Stripe failure throws `StripeApiError` (route: 502).
 */
export async function createStripeCheckout(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<StripeCheckoutIntent | null> {
  await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return null;
  }
  const customerId = await findOrCreateCustomer(
    sessionUserId,
    deps.stripe ?? {},
  );
  if (!customerId) {
    return null;
  }
  return createSyncSubscription(
    { customerId, userId: sessionUserId, organizationId },
    deps.stripe ?? {},
  );
}

/**
 * Resolves the buyer's Billing Portal URL. Null when unconfigured or when the
 * user has no Stripe customer yet (nothing to manage).
 */
export async function createStripePortalUrl(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  returnUrl: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<string | null> {
  await runRequireBillingAdminWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isStripeCheckoutConfigured(deps.stripe ?? {})) {
    return null;
  }
  const customerId = await findOrCreateCustomer(
    sessionUserId,
    deps.stripe ?? {},
  );
  if (!customerId) {
    return null;
  }
  return createPortalSession({ customerId, returnUrl }, deps.stripe ?? {});
}

type StripeWebhookOutcome =
  | { status: "associated"; subscriptionId: string; organizationId: string }
  | { status: "ignored"; reason: string }
  | { status: "retry"; reason: string }
  | { status: "unauthorized" }
  | { status: "unconfigured" };

/**
 * Handles one raw Stripe webhook delivery: verify the signature, extract the
 * newly paid subscription, read its authoritative binding from Stripe, then
 * associate it with RevenueCat. Association failures propagate (route: 500)
 * so Stripe redelivers; everything the flow does not care about is `ignored`.
 */
export async function processStripeWebhook(
  input: { payload: string; signatureHeader: string | undefined },
  deps: StripeCheckoutServiceDeps = {},
): Promise<StripeWebhookOutcome> {
  const env = deps.stripe?.env ?? process.env;
  const secret = readStripeWebhookSecret(env);
  if (!secret) {
    return { status: "unconfigured" };
  }
  if (
    !verifyStripeSignature({
      payload: input.payload,
      signatureHeader: input.signatureHeader,
      secret,
    })
  ) {
    return { status: "unauthorized" };
  }

  let event: unknown;
  try {
    event = JSON.parse(input.payload);
  } catch {
    return { status: "ignored", reason: "Invalid JSON payload" };
  }
  const subscriptionId = extractPaidSubscriptionId(event);
  if (!subscriptionId) {
    return { status: "ignored", reason: "Not a newly paid subscription" };
  }
  // A paid subscription that cannot currently be looked up must NOT be
  // acknowledged with a 2xx: Stripe would never redeliver, permanently
  // stranding the purchase unassociated. Ask for redelivery instead.
  if (!isStripeCheckoutConfigured(deps.stripe ?? {})) {
    return { status: "retry", reason: "Stripe API is not configured" };
  }

  // Read the binding from Stripe rather than trusting the event body: the
  // subscription's metadata is what OUR server wrote at checkout time.
  const binding = await getSubscriptionBinding(
    subscriptionId,
    deps.stripe ?? {},
  );
  if (
    !binding?.userId ||
    !binding.organizationId ||
    !isUuidV4String(binding.organizationId)
  ) {
    return { status: "ignored", reason: "Subscription carries no org binding" };
  }

  await associateStripeSubscription(
    {
      appUserId: binding.userId,
      organizationId: binding.organizationId,
      subscriptionId,
    },
    deps.revenueCat ?? {},
  );
  return {
    status: "associated",
    subscriptionId,
    organizationId: binding.organizationId,
  };
}
