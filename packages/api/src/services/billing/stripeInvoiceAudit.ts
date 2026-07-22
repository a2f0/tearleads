import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getPaidSubscriptionInvoice } from "../../billing/stripeInvoice";
import type { StripeSubscriptionBinding } from "../../billing/stripeSubscriptionBinding";
import type { StripePaidSubscriptionInvoice } from "../../billing/stripeWebhook";
import {
  runRecordStripeInvoiceAuditWorkflow,
  type StripeInvoiceAuditInput,
} from "../../workflows/billing/stripeInvoiceAudit";

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

function createStripeInvoiceAuditInput(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
}): StripeInvoiceAuditInput | null {
  const { binding, invoice } = input;
  if (!invoice.invoiceId || invoice.amountPaid === null || !invoice.currency) {
    return null;
  }
  if (invoice.linesHasMore !== false) {
    return null;
  }
  const line = selectHistoricalSeatLine(invoice, binding);
  const base = {
    billingReason: invoice.billingReason,
    currency: invoice.currency,
    invoiceId: invoice.invoiceId,
    occurredAt: invoice.occurredAt,
    organizationId: input.organizationId,
    providerEventId: invoice.providerEventId,
    subscriptionId: invoice.subscriptionId,
    totalAmount: invoice.amountPaid,
  };
  const totalOnlySnapshot: StripeInvoiceAuditInput = {
    ...base,
    interval: null,
    intervalCount: null,
    periodEndsAt: null,
    periodStartsAt: null,
    priceId: null,
    seatCount: null,
    unitAmount: null,
  };
  if (!line) {
    return totalOnlySnapshot;
  }
  if (
    line.quantity === null ||
    !line.priceId ||
    !line.periodStartsAt ||
    !line.periodEndsAt ||
    (line.currency !== null && line.currency !== invoice.currency)
  ) {
    return totalOnlySnapshot;
  }
  return {
    ...base,
    interval: line.interval,
    intervalCount: line.intervalCount,
    periodEndsAt: line.periodEndsAt,
    periodStartsAt: line.periodStartsAt,
    priceId: line.priceId,
    seatCount: line.quantity,
    unitAmount: line.unitAmount,
  };
}

/** Resolves a complete, immutable invoice snapshot before the audit insert. */
export async function resolveStripeInvoiceAuditInput(input: {
  readonly binding: StripeSubscriptionBinding;
  readonly invoice: StripePaidSubscriptionInvoice;
  readonly organizationId: string;
  readonly stripeDeps: StripeApiDeps;
}): Promise<StripeInvoiceAuditInput | null> {
  const direct = createStripeInvoiceAuditInput(input);
  if (direct || !input.invoice.invoiceId) {
    return direct;
  }
  const fetched = await getPaidSubscriptionInvoice(
    input.invoice.invoiceId,
    input.stripeDeps,
  );
  if (!fetched || fetched.subscriptionId !== input.invoice.subscriptionId) {
    return null;
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
  if (outcome === "conflict") {
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
  return { status: "accepted", audit } as const;
}
