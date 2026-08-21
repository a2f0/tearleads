import { isUuidV4String } from "@symcrypt/validators/util";
import { associateStripeSubscription } from "../../billing/revenueCatStripeAssociation";
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  createSyncSubscription,
  findLiveOrgSubscription,
  findOrCreateCustomer,
  hasOpenOrgSubscription,
  isStripeCheckoutConfigured,
  StripeApiError,
  type StripeCheckoutIntent,
} from "../../billing/stripeApi";
import { getSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import {
  extractPaidSubscriptionInvoice,
  readStripeWebhookSecret,
  verifyStripeSignature,
} from "../../billing/stripeWebhook";
import {
  runAcquireStripeCheckoutAttemptWorkflow,
  runRequireCheckoutEligibleWorkflow,
  runResolveOrgSubscriptionForAdminWorkflow,
} from "../../workflows/billing/stripeCheckout";
import {
  runBindOrganizationStripeSeatsWorkflow,
  runRecordStripeSeatRenewalWorkflow,
  type StripeSeatBindingInput,
} from "../../workflows/billing/stripeSeatState";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";
import {
  isDirectCheckoutFullyConfigured,
  type StripeCheckoutServiceDeps,
} from "./stripeCheckoutConfiguration";
import {
  reconcilesSeatPeriod,
  resolveAndRecordStripeInvoiceAudit,
} from "./stripeInvoiceAudit";

/** Direct Stripe checkout services; user-facing calls enforce org-admin access. */

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
  if (!isDirectCheckoutFullyConfigured(deps)) {
    await runRequireCheckoutEligibleWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    );
    return null;
  }
  const attempt = await runAcquireStripeCheckoutAttemptWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    "inline",
  );
  const customerId = await findOrCreateCustomer(
    { userId: sessionUserId, organizationId },
    deps.stripe ?? {},
  );
  if (!customerId) {
    return null;
  }
  const outcome = await createSyncSubscription(
    {
      checkoutAttemptId: attempt.attemptId,
      customerId,
      userId: sessionUserId,
      organizationId,
      seatQuantity: attempt.seatQuantity,
    },
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
 * admin gate, same local-status eligibility guard, and the same Stripe-side
 * duplicate guard (an already-subscribed org is a 409), same full-configuration
 * requirement (the resulting subscription flows through the same webhook →
 * RevenueCat association), and the same per-(user, org) customer. Null when
 * unconfigured.
 */
export async function createStripeCheckoutSession(
  runtime: ApiServiceRuntime,
  organizationId: string,
  sessionUserId: string,
  returnUrl: string,
  deps: StripeCheckoutServiceDeps = {},
): Promise<string | null> {
  if (!isDirectCheckoutFullyConfigured(deps)) {
    await runRequireCheckoutEligibleWorkflow(
      runtime.db,
      organizationId,
      sessionUserId,
    );
    return null;
  }
  const attempt = await runAcquireStripeCheckoutAttemptWorkflow(
    runtime.db,
    organizationId,
    sessionUserId,
    "hosted",
  );
  // Stripe-side duplicate guard, mirroring the inline flow. The local billing
  // status the eligibility workflow reads can lag Stripe (e.g. a webhook
  // outage), so a session minted here could complete into a SECOND billing
  // subscription and double-bill. `createSyncSubscription` closes this window
  // for inline checkout via its own search; check explicitly here before
  // minting a hosted Session. A still-incomplete inline subscription blocks as
  // well because its payment could complete while the hosted page is open.
  const existing = await hasOpenOrgSubscription(
    organizationId,
    deps.stripe ?? {},
  );
  if (existing) {
    throw new OrganizationManagerError(
      "The organization already has an active subscription",
      409,
    );
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
      checkoutAttemptId: attempt.attemptId,
      customerId,
      expiresAt: attempt.providerExpiresAt ?? attempt.expiresAt,
      userId: sessionUserId,
      organizationId,
      returnUrl,
      seatQuantity: attempt.seatQuantity,
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
  | { status: "reconciled"; subscriptionId: string; organizationId: string }
  | { status: "ignored"; reason: string }
  | { status: "retry"; reason: string }
  | { status: "unauthorized" }
  | { status: "unconfigured" };

type StripeWebhookAuthentication =
  | { status: "authenticated" }
  | { status: "unauthorized" }
  | { status: "unconfigured" };

type StripeAuthenticatedWebhookOutcome = Exclude<
  StripeWebhookOutcome,
  { status: "unauthorized" | "unconfigured" }
>;

interface PaidSubscriptionInvoiceInput {
  readonly binding: NonNullable<
    Awaited<ReturnType<typeof getSubscriptionBinding>>
  >;
  readonly deps: StripeCheckoutServiceDeps;
  readonly invoice: NonNullable<
    ReturnType<typeof extractPaidSubscriptionInvoice>
  >;
  readonly organizationId: string;
  readonly runtime: ApiServiceRuntime;
}

async function fulfillSeatPeriodInvoice(
  input: PaidSubscriptionInvoiceInput,
  renewalInvoiceId: string | null,
): Promise<StripeAuthenticatedWebhookOutcome> {
  const { binding, invoice } = input;
  if (
    !binding.priceId ||
    !binding.subscriptionItemId ||
    binding.seatQuantity === null
  ) {
    return { status: "retry", reason: "Subscription carries no seat item" };
  }
  const seatBinding: StripeSeatBindingInput = {
    billingPeriodEndsAt: binding.billingPeriodEndsAt,
    billingPeriodStartsAt: binding.billingPeriodStartsAt,
    customerId: binding.customerId,
    organizationId: input.organizationId,
    priceId: binding.priceId,
    seatQuantity: binding.seatQuantity,
    subscriptionId: invoice.subscriptionId,
    subscriptionItemId: binding.subscriptionItemId,
  };
  if (renewalInvoiceId !== null) {
    const outcome = await runRecordStripeSeatRenewalWorkflow(input.runtime.db, {
      ...seatBinding,
      invoiceId: renewalInvoiceId,
    });
    if (outcome.status === "retry") {
      return {
        status: "retry",
        reason: "Stripe subscription ordering is ambiguous",
      };
    }
    if (outcome.status === "stale") {
      return { status: "ignored", reason: "Stale Stripe subscription invoice" };
    }
    return {
      status: "reconciled",
      subscriptionId: invoice.subscriptionId,
      organizationId: input.organizationId,
    };
  }
  if (!binding.userId) {
    return {
      status: "ignored",
      reason: "Subscription carries no user binding",
    };
  }
  const outcome = await runBindOrganizationStripeSeatsWorkflow(
    input.runtime.db,
    seatBinding,
  );
  if (outcome.status === "retry") {
    return {
      status: "retry",
      reason: "Stripe subscription ordering is ambiguous",
    };
  }
  if (outcome.status === "stale") {
    return { status: "ignored", reason: "Stale Stripe subscription invoice" };
  }
  await associateStripeSubscription(
    {
      appUserId: binding.userId,
      organizationId: input.organizationId,
      subscriptionId: invoice.subscriptionId,
    },
    input.deps.revenueCat ?? {},
  );
  return {
    status: "associated",
    subscriptionId: invoice.subscriptionId,
    organizationId: input.organizationId,
  };
}

async function applyPaidSubscriptionInvoice(
  input: PaidSubscriptionInvoiceInput,
): Promise<StripeAuthenticatedWebhookOutcome> {
  const { invoice } = input;
  if (invoice.billingReason === "subscription_cycle" && !invoice.invoiceId) {
    return { status: "ignored", reason: "Renewal invoice carries no id" };
  }
  const requiresSeatPeriod = reconcilesSeatPeriod(invoice.billingReason);
  const auditOutcome = await resolveAndRecordStripeInvoiceAudit({
    binding: input.binding,
    db: input.runtime.db,
    invoice: input.invoice,
    organizationId: input.organizationId,
    stripeDeps: input.deps.stripe ?? {},
  });
  if (auditOutcome.status === "incomplete") {
    if (invoice.billingReason === "subscription_create" && !invoice.invoiceId) {
      return fulfillSeatPeriodInvoice(input, null);
    }
    if (requiresSeatPeriod) {
      return { status: "retry", reason: "Paid invoice details are incomplete" };
    }
    console.warn("Paid invoice audit details are unavailable", {
      invoiceId: invoice.invoiceId,
      organizationId: input.organizationId,
      providerEventId: invoice.providerEventId,
    });
    return {
      status: "ignored",
      reason: "Paid invoice audit details unavailable",
    };
  }
  if (auditOutcome.status === "conflict") {
    return { status: "ignored", reason: "Conflicting paid invoice snapshot" };
  }
  const auditInput = auditOutcome.audit;
  if (!reconcilesSeatPeriod(auditInput.billingReason)) {
    return {
      status: "ignored",
      reason: "Paid invoice requires no seat-period reconciliation",
    };
  }
  return fulfillSeatPeriodInvoice(
    input,
    auditInput.billingReason === "subscription_cycle"
      ? auditInput.invoiceId
      : null,
  );
}

/** Authenticates a Stripe delivery against its exact raw request body. */
export function authenticateStripeWebhook(
  input: { payload: string; signatureHeader: string | undefined },
  deps: StripeCheckoutServiceDeps = {},
): StripeWebhookAuthentication {
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
  return { status: "authenticated" };
}

/** Fulfills a provider-authenticated, boundary-parsed Stripe event. */
export async function processAuthenticatedStripeWebhook(
  runtime: ApiServiceRuntime,
  event: unknown,
  deps: StripeCheckoutServiceDeps = {},
): Promise<StripeAuthenticatedWebhookOutcome> {
  const invoice = extractPaidSubscriptionInvoice(event);
  if (!invoice) {
    return { status: "ignored", reason: "Not a paid subscription invoice" };
  }
  // Ask for redelivery when the subscription cannot be looked up; a 2xx could
  // permanently strand the purchase unassociated.
  if (!isStripeCheckoutConfigured(deps.stripe ?? {})) {
    return { status: "retry", reason: "Stripe API is not configured" };
  }

  // Read the binding from Stripe rather than trusting the event body: the
  // subscription's metadata is what OUR server wrote at checkout time.
  let binding: Awaited<ReturnType<typeof getSubscriptionBinding>>;
  try {
    binding = await getSubscriptionBinding(
      invoice.subscriptionId,
      deps.stripe ?? {},
    );
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
    !binding ||
    !binding.organizationId ||
    !isUuidV4String(binding.organizationId)
  ) {
    return { status: "ignored", reason: "Subscription carries no org binding" };
  }

  return applyPaidSubscriptionInvoice({
    binding,
    deps,
    invoice,
    organizationId: binding.organizationId,
    runtime,
  });
}

/** Compatibility facade that authenticates, parses, and fulfills a delivery. */
export async function processStripeWebhook(
  runtime: ApiServiceRuntime,
  input: { payload: string; signatureHeader: string | undefined },
  deps: StripeCheckoutServiceDeps = {},
): Promise<StripeWebhookOutcome> {
  const authentication = authenticateStripeWebhook(input, deps);
  if (authentication.status !== "authenticated") {
    return authentication;
  }

  let event: unknown;
  try {
    event = JSON.parse(input.payload);
  } catch {
    return { status: "ignored", reason: "Invalid JSON payload" };
  }
  return processAuthenticatedStripeWebhook(runtime, event, deps);
}
