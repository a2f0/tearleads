import { isUuidV4String } from "@tearleads/validators/util";
import {
  associateStripeSubscription,
  isRevenueCatAssociationConfigured,
  type RevenueCatAssociationDeps,
} from "../../billing/revenueCatStripeAssociation";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  createSyncSubscription,
  findLiveOrgSubscription,
  findOrCreateCustomer,
  getStripeSyncOption,
  getSubscriptionBinding,
  isStripeCheckoutConfigured,
  type StripeApiDeps,
  StripeApiError,
  type StripeCheckoutIntent,
  type StripeSyncOption,
} from "../../billing/stripeApi";
import {
  extractPaidSubscriptionId,
  readStripeWebhookSecret,
  verifyStripeSignature,
} from "../../billing/stripeWebhook";
import {
  runRequireCheckoutEligibleWorkflow,
  runResolveOrgSubscriptionForAdminWorkflow,
} from "../../workflows/billing/stripeCheckout";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
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
    { userId: sessionUserId, organizationId },
    deps.stripe ?? {},
  );
  if (!customerId) {
    return null;
  }
  const outcome = await createSyncSubscription(
    { customerId, userId: sessionUserId, organizationId },
    deps.stripe ?? {},
  );
  if (outcome?.kind === "conflict") {
    // Stripe already holds a live (or unreadable pending) subscription for
    // this org — even if our billing row has not caught up yet, e.g. after a
    // long webhook outage. Creating another would double-bill the org.
    throw new OrganizationManagerError(
      "The organization already has an active subscription",
      409,
    );
  }
  return outcome ? outcome.intent : null;
}

/**
 * The off-site alternative to {@link createStripeCheckout}: returns a hosted
 * Stripe Checkout page URL for a buyer who does not want the inline form. Same
 * admin gate and eligibility guard (an already-active org is a 409), same
 * full-configuration requirement (the resulting subscription flows through the
 * same webhook → RevenueCat association), and the same per-(user, org)
 * customer. Null when unconfigured.
 */
export async function createStripeCheckoutSession(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  returnUrl: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<string | null> {
  await runRequireCheckoutEligibleWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isDirectCheckoutFullyConfigured(deps)) {
    return null;
  }
  const customerId = await findOrCreateCustomer(
    { userId: sessionUserId, organizationId },
    deps.stripe ?? {},
  );
  if (!customerId) {
    return null;
  }
  // One origin-validated URL for both outcomes: the buyer lands back on the
  // billing panel whether they paid or backed out, and a paid return reads as
  // activation-pending until the webhook grants the entitlement.
  return createCheckoutSession(
    {
      customerId,
      userId: sessionUserId,
      organizationId,
      successUrl: returnUrl,
      cancelUrl: returnUrl,
    },
    deps.stripe ?? {},
  );
}

/**
 * Resolves the Billing Portal URL for THE ORGANIZATION'S subscription. The
 * customer is read from the org's live Stripe subscription (found by `orgId`
 * metadata), never from the caller — a co-admin manages the org's
 * subscription, and a multi-org purchaser is never handed a portal spanning
 * other organizations. Null when unconfigured or when the org has no live
 * Stripe subscription (a RevenueCat/store subscription uses the RevenueCat
 * management URL route instead).
 */
export async function createStripePortalUrl(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  returnUrl: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<string | null> {
  // Admin gate. The resolved id is intentionally ignored: the billing row's
  // `providerSubscriptionId` is the RevenueCat-reported Stripe item id
  // (`si_…`), not the `sub_…` the portal needs, so Stripe itself is the source
  // of truth for the subscription (see findLiveOrgSubscription).
  await runResolveOrgSubscriptionForAdminWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isStripeCheckoutConfigured(deps.stripe ?? {})) {
    return null;
  }
  const found = await findLiveOrgSubscription(
    organizationId,
    deps.stripe ?? {},
  );
  if (!found) {
    return null;
  }
  return createPortalSession(
    { customerId: found.customerId, returnUrl },
    deps.stripe ?? {},
  );
}

/**
 * Cancels the org's sync subscription at the end of the paid period.
 *
 * Guards mirror {@link createStripePortalUrl}: the caller must be an admin, and
 * the subscription is resolved from Stripe by the org's `orgId` metadata — so a
 * legacy or foreign subscription on a pooled customer can never be cancelled
 * for the wrong organization.
 *
 * Returns null when Stripe is unconfigured or no cancellable subscription
 * belongs to the org — the caller renders no cancel affordance either way.
 */
export async function cancelStripeSubscription(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<{ cancelAt: number | null } | null> {
  // Admin gate; the resolved id is intentionally ignored (see
  // createStripePortalUrl and findLiveOrgSubscription — Stripe is the source
  // of truth, not the RevenueCat-reported `si_…` in the billing row).
  await runResolveOrgSubscriptionForAdminWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
  );
  if (!isStripeCheckoutConfigured(deps.stripe ?? {})) {
    return null;
  }
  const found = await findLiveOrgSubscription(
    organizationId,
    deps.stripe ?? {},
  );
  if (!found) {
    return null;
  }
  return cancelSubscriptionAtPeriodEnd(found.subscriptionId, deps.stripe ?? {});
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
  let binding: Awaited<ReturnType<typeof getSubscriptionBinding>>;
  try {
    binding = await getSubscriptionBinding(subscriptionId, deps.stripe ?? {});
  } catch (error) {
    // A definitive 404 will never become fetchable: acknowledge it instead
    // of making Stripe redeliver forever (mirrors the RevenueCat-side
    // resolution). Transient failures still propagate for redelivery.
    if (error instanceof StripeApiError && error.status === 404) {
      return { status: "ignored", reason: "Subscription not found" };
    }
    throw error;
  }
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
