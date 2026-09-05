import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import { SYNC_BILLING_TIERS } from "@tearleads/validators/billing";
import type { StripeApiDeps } from "../../billing/stripeApi";
import {
  getSyncBillingTierForStripePrice,
  StripeApiError,
} from "../../billing/stripeHttp";
import {
  getPaidSubscriptionInvoice,
  type StripePaidSubscriptionInvoiceLookup,
} from "../../billing/stripeInvoice";
import type { StripeSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import type {
  StripeInvoiceBillingReason,
  StripePaidSubscriptionInvoice,
} from "../../billing/stripeWebhook";
import {
  runRecordStripeInvoiceAuditWorkflow,
  type StripeInvoiceAuditInput,
} from "../../workflows/billing/stripeInvoiceAudit";

const INVOICE_AUDIT_DETAIL_FIELDS = [
  "interval",
  "intervalCount",
  "periodEndsAt",
  "periodStartsAt",
  "priceId",
  "seatCount",
  "unitAmount",
] as const;
const COMPLETE_INVOICE_DETAIL_SCORE = INVOICE_AUDIT_DETAIL_FIELDS.length;

export function reconcilesSeatPeriod(
  billingReason: StripeInvoiceBillingReason,
): boolean {
  return (
    billingReason === "subscription_create" ||
    billingReason === "subscription_cycle"
  );
}

function selectHistoricalSeatLine(
  invoice: StripePaidSubscriptionInvoice,
  binding: StripeSubscriptionBinding,
) {
  const candidates = invoice.lines.filter((line) => {
    const isAttributable =
      line.subscriptionId === invoice.subscriptionId ||
      (line.subscriptionId === null && line.subscriptionItemId !== null);
    return (
      line.proration === false &&
      isAttributable &&
      line.quantity !== null &&
      line.priceId !== null &&
      line.periodStartsAt !== null &&
      line.periodEndsAt !== null
    );
  });
  if (binding.subscriptionItemId !== null) {
    const itemMatches = candidates.filter(
      (line) => line.subscriptionItemId === binding.subscriptionItemId,
    );
    if (itemMatches.length === 1) {
      return itemMatches[0];
    }
  }
  if (binding.priceId !== null) {
    const priceMatches = candidates.filter(
      (line) => line.priceId === binding.priceId,
    );
    if (priceMatches.length === 1) {
      return priceMatches[0];
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function createTotalOnlyAuditInput(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
}): StripeInvoiceAuditInput | null {
  const { invoice } = input;
  if (!invoice.invoiceId || invoice.amountPaid === null || !invoice.currency) {
    return null;
  }
  return {
    billingReason: invoice.billingReason,
    currency: invoice.currency,
    interval: null,
    intervalCount: null,
    invoiceId: invoice.invoiceId,
    occurredAt: invoice.occurredAt,
    organizationId: input.organizationId,
    periodEndsAt: null,
    periodStartsAt: null,
    priceId: null,
    providerEventId: invoice.providerEventId,
    seatCount: null,
    subscriptionId: invoice.subscriptionId,
    totalAmount: invoice.amountPaid,
    unitAmount: null,
  };
}

function createStripeInvoiceAuditInput(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
  readonly stripeDeps: StripeApiDeps;
}): StripeInvoiceAuditInput | null {
  const totalOnlySnapshot = createTotalOnlyAuditInput(input);
  if (!totalOnlySnapshot || input.invoice.linesHasMore !== false) {
    return null;
  }
  const line = selectHistoricalSeatLine(input.invoice, input.binding);
  if (!line) {
    return totalOnlySnapshot;
  }
  if (
    line.quantity === null ||
    !line.priceId ||
    !line.periodStartsAt ||
    !line.periodEndsAt ||
    (line.currency !== null && line.currency !== totalOnlySnapshot.currency)
  ) {
    return totalOnlySnapshot;
  }
  const hasCompleteTierEconomics =
    line.quantity === 1 &&
    line.currency === "usd" &&
    line.interval === "month" &&
    line.intervalCount === 1 &&
    line.unitAmount !== null;
  const configuredTier = getSyncBillingTierForStripePrice(
    line.priceId,
    input.stripeDeps,
  );
  // Fixed tiers are quantity-one Prices. Unknown economics must not turn a
  // provider item count into licensed seat capacity.
  const economicsTier = hasCompleteTierEconomics
    ? (SYNC_BILLING_TIERS.find(
        (tier) => line.unitAmount === tier.monthlyPriceUsdCents,
      ) ?? null)
    : null;
  const resolvedTier =
    line.quantity === 1 ? (economicsTier ?? configuredTier) : null;
  return {
    ...totalOnlySnapshot,
    interval: line.interval,
    intervalCount: line.intervalCount,
    periodEndsAt: line.periodEndsAt,
    periodStartsAt: line.periodStartsAt,
    priceId: line.priceId,
    seatCount: resolvedTier?.seatLimit ?? null,
    unitAmount: line.unitAmount,
  };
}

function auditDetailScore(audit: StripeInvoiceAuditInput): number {
  return INVOICE_AUDIT_DETAIL_FIELDS.filter((field) => audit[field] !== null)
    .length;
}

interface StripeInvoiceAuditResolutionInput {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
  readonly stripeDeps: StripeApiDeps;
}

function resolveFetchedInvoiceAudit(
  input: StripeInvoiceAuditResolutionInput,
  direct: StripeInvoiceAuditInput | null,
  directTotal: StripeInvoiceAuditInput | null,
  lookup: StripePaidSubscriptionInvoiceLookup,
): StripeInvoiceAuditInput | null {
  if (lookup.status === "identity_mismatch") {
    return null;
  }
  if (lookup.status === "invalid") {
    return direct ?? directTotal;
  }
  const fetched = lookup.invoice;
  if (fetched.subscriptionId !== input.invoice.subscriptionId) {
    return null;
  }
  const fetchedInput = {
    ...input,
    invoice: {
      ...fetched,
      providerEventId: input.invoice.providerEventId ?? fetched.providerEventId,
    },
  };
  if (lookup.status === "line_details_unavailable") {
    return direct ?? directTotal ?? createTotalOnlyAuditInput(fetchedInput);
  }
  const enriched = createStripeInvoiceAuditInput({
    ...input,
    invoice: {
      ...input.invoice,
      lines: fetched.lines,
      linesHasMore: fetched.linesHasMore,
    },
  });
  if (enriched) {
    return !direct || auditDetailScore(enriched) > auditDetailScore(direct)
      ? enriched
      : direct;
  }
  return createStripeInvoiceAuditInput(fetchedInput);
}

/** Resolves a complete, immutable invoice snapshot before the audit insert. */
export async function resolveStripeInvoiceAuditInput(
  input: StripeInvoiceAuditResolutionInput,
): Promise<StripeInvoiceAuditInput | null> {
  const direct = createStripeInvoiceAuditInput(input);
  const directTotal = createTotalOnlyAuditInput(input);
  const requiresSeatPeriod = reconcilesSeatPeriod(input.invoice.billingReason);
  if (!requiresSeatPeriod && directTotal) {
    return direct ?? directTotal;
  }
  if (direct && auditDetailScore(direct) === COMPLETE_INVOICE_DETAIL_SCORE) {
    return direct;
  }
  if (!input.invoice.invoiceId) {
    return direct;
  }
  let lookup: StripePaidSubscriptionInvoiceLookup;
  try {
    lookup = await getPaidSubscriptionInvoice(
      input.invoice.invoiceId,
      input.stripeDeps,
      input.invoice.occurredAt,
      input.invoice.subscriptionId,
    );
  } catch (error) {
    if ((direct || directTotal) && error instanceof StripeApiError) {
      console.warn(
        "Stripe invoice detail enrichment failed; preserving the signed snapshot",
        { invoiceId: input.invoice.invoiceId, status: error.status },
      );
      return direct ?? directTotal;
    }
    if (
      !requiresSeatPeriod &&
      error instanceof StripeApiError &&
      error.status === 404
    ) {
      return null;
    }
    throw error;
  }
  return resolveFetchedInvoiceAudit(input, direct, directTotal, lookup);
}

/** Resolves and append-only records one paid invoice delivery. */
export async function resolveAndRecordStripeInvoiceAudit(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly db: ApiDatabase;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
  readonly stripeDeps: StripeApiDeps;
}) {
  const audit = await resolveStripeInvoiceAuditInput(input);
  if (!audit) {
    return { status: "incomplete" } as const;
  }
  const outcome = await runRecordStripeInvoiceAuditWorkflow(input.db, audit);
  if (outcome.status === "conflict") {
    console.error(
      "Conflicting Stripe invoice audit snapshot; preserving the first snapshot",
      {
        invoiceId: audit.invoiceId,
        organizationId: input.organizationId,
        providerEventId: audit.providerEventId,
      },
    );
    return { status: "conflict" } as const;
  }
  if (outcome.status === "compatible") {
    console.warn(
      "Compatible Stripe invoice audit redelivery differs; preserving the first snapshot and continuing fulfillment",
      {
        invoiceId: audit.invoiceId,
        organizationId: input.organizationId,
        providerEventId: audit.providerEventId,
      },
    );
  }
  return { status: "accepted", audit: outcome.audit } as const;
}
