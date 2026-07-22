import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { StripeApiError } from "../../billing/stripeHttp";
import { getPaidSubscriptionInvoice } from "../../billing/stripeInvoice";
import type { StripeSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import type {
  StripeInvoiceBillingReason,
  StripePaidSubscriptionInvoice,
} from "../../billing/stripeWebhook";
import {
  runRecordStripeInvoiceAuditWorkflow,
  type StripeInvoiceAuditInput,
} from "../../workflows/billing/stripeInvoiceAudit";

const COMPLETE_INVOICE_DETAIL_SCORE = 7;

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
  const candidates = invoice.lines.filter(
    (line) =>
      line.proration === false &&
      (line.subscriptionId === null ||
        line.subscriptionId === invoice.subscriptionId) &&
      (line.subscriptionId === invoice.subscriptionId ||
        line.subscriptionItemId !== null) &&
      line.quantity !== null &&
      line.priceId !== null &&
      line.periodStartsAt !== null &&
      line.periodEndsAt !== null,
  );
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
  return {
    ...totalOnlySnapshot,
    interval: line.interval,
    intervalCount: line.intervalCount,
    periodEndsAt: line.periodEndsAt,
    periodStartsAt: line.periodStartsAt,
    priceId: line.priceId,
    seatCount: line.quantity,
    unitAmount: line.unitAmount,
  };
}

function auditDetailScore(audit: StripeInvoiceAuditInput): number {
  return [
    audit.interval,
    audit.intervalCount,
    audit.periodEndsAt,
    audit.periodStartsAt,
    audit.priceId,
    audit.seatCount,
    audit.unitAmount,
  ].filter((value) => value !== null).length;
}

/** Resolves a complete, immutable invoice snapshot before the audit insert. */
export async function resolveStripeInvoiceAuditInput(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
  readonly stripeDeps: StripeApiDeps;
}): Promise<StripeInvoiceAuditInput | null> {
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
  let fetched: StripePaidSubscriptionInvoice | null;
  try {
    fetched = await getPaidSubscriptionInvoice(
      input.invoice.invoiceId,
      input.stripeDeps,
      input.invoice.occurredAt,
    );
  } catch (error) {
    if (direct && error instanceof StripeApiError) {
      console.warn(
        "Stripe invoice detail enrichment failed; preserving the signed snapshot",
        { invoiceId: input.invoice.invoiceId, status: error.status },
      );
      return direct;
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
  if (!fetched || fetched.subscriptionId !== input.invoice.subscriptionId) {
    return direct;
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
  return createStripeInvoiceAuditInput({
    ...input,
    invoice: {
      ...fetched,
      providerEventId: input.invoice.providerEventId ?? fetched.providerEventId,
    },
  });
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
