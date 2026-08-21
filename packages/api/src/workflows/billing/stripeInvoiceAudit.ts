import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  type OrganizationBillingInvoiceReason,
  organizationBillingInvoiceEvents,
} from "@symcrypt/api-shared/schema";
import { eq } from "drizzle-orm";

export interface StripeInvoiceAuditInput {
  readonly billingReason: OrganizationBillingInvoiceReason;
  readonly currency: string;
  readonly interval: string | null;
  readonly intervalCount: number | null;
  readonly invoiceId: string;
  readonly occurredAt: Date;
  readonly organizationId: string;
  readonly periodEndsAt: Date | null;
  readonly periodStartsAt: Date | null;
  readonly priceId: string | null;
  readonly providerEventId: string | null;
  readonly seatCount: number | null;
  readonly subscriptionId: string;
  readonly totalAmount: number;
  readonly unitAmount: number | null;
}

type StripeInvoiceAuditRecordOutcome =
  | { readonly status: "accepted"; readonly audit: StripeInvoiceAuditInput }
  | { readonly status: "compatible"; readonly audit: StripeInvoiceAuditInput }
  | { readonly status: "conflict" };

function equalDates(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

function isEquivalentSnapshot(
  existing: StripeInvoiceAuditInput,
  incoming: StripeInvoiceAuditInput,
): boolean {
  return (
    existing.billingReason === incoming.billingReason &&
    existing.currency === incoming.currency &&
    existing.interval === incoming.interval &&
    existing.intervalCount === incoming.intervalCount &&
    existing.invoiceId === incoming.invoiceId &&
    equalDates(existing.occurredAt, incoming.occurredAt) &&
    existing.organizationId === incoming.organizationId &&
    equalDates(existing.periodEndsAt, incoming.periodEndsAt) &&
    equalDates(existing.periodStartsAt, incoming.periodStartsAt) &&
    existing.priceId === incoming.priceId &&
    existing.providerEventId === incoming.providerEventId &&
    existing.seatCount === incoming.seatCount &&
    existing.subscriptionId === incoming.subscriptionId &&
    existing.totalAmount === incoming.totalAmount &&
    existing.unitAmount === incoming.unitAmount
  );
}

function isCompatibleSnapshot(
  existing: StripeInvoiceAuditInput,
  incoming: StripeInvoiceAuditInput,
): boolean {
  return (
    existing.billingReason === incoming.billingReason &&
    existing.currency === incoming.currency &&
    existing.invoiceId === incoming.invoiceId &&
    existing.organizationId === incoming.organizationId &&
    existing.subscriptionId === incoming.subscriptionId &&
    existing.totalAmount === incoming.totalAmount
  );
}

/** Records the first immutable snapshot observed for a paid Stripe invoice. */
export async function runRecordStripeInvoiceAuditWorkflow(
  db: ApiDatabase,
  input: StripeInvoiceAuditInput,
): Promise<StripeInvoiceAuditRecordOutcome> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(organizationBillingInvoiceEvents)
      .values(input)
      .onConflictDoNothing({
        target: organizationBillingInvoiceEvents.invoiceId,
      })
      .returning({ id: organizationBillingInvoiceEvents.id });
    if (inserted) {
      return { status: "accepted", audit: input };
    }
    const [existing] = await tx
      .select({
        billingReason: organizationBillingInvoiceEvents.billingReason,
        currency: organizationBillingInvoiceEvents.currency,
        interval: organizationBillingInvoiceEvents.interval,
        intervalCount: organizationBillingInvoiceEvents.intervalCount,
        invoiceId: organizationBillingInvoiceEvents.invoiceId,
        organizationId: organizationBillingInvoiceEvents.organizationId,
        periodEndsAt: organizationBillingInvoiceEvents.periodEndsAt,
        periodStartsAt: organizationBillingInvoiceEvents.periodStartsAt,
        priceId: organizationBillingInvoiceEvents.priceId,
        providerEventId: organizationBillingInvoiceEvents.providerEventId,
        seatCount: organizationBillingInvoiceEvents.seatCount,
        subscriptionId: organizationBillingInvoiceEvents.subscriptionId,
        totalAmount: organizationBillingInvoiceEvents.totalAmount,
        unitAmount: organizationBillingInvoiceEvents.unitAmount,
        occurredAt: organizationBillingInvoiceEvents.occurredAt,
      })
      .from(organizationBillingInvoiceEvents)
      .where(eq(organizationBillingInvoiceEvents.invoiceId, input.invoiceId));
    if (!existing) {
      throw new Error(
        `Stripe invoice audit snapshot disappeared for ${input.invoiceId}`,
      );
    }
    if (isEquivalentSnapshot(existing, input)) {
      return { status: "accepted", audit: existing };
    }
    return isCompatibleSnapshot(existing, input)
      ? { status: "compatible", audit: existing }
      : { status: "conflict" };
  });
}
