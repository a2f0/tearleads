import type { OrganizationBillingHistoryEntry } from "@tearleads/client-sdk";
import { MiniAppRowText } from "../../../components/mini-app/rows/MiniAppRow";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { getOrgManagerSeatsLabel } from "../labels";
import { formatPrice, formatTotalAmount } from "./billingFormatters";

interface BillingHistoryEntryDetailsProps {
  readonly entry: OrganizationBillingHistoryEntry;
  readonly includeAuditFields?: boolean;
}

function getSignedCount(count: number): string {
  return count >= 0 ? `+${count}` : String(count);
}

function getActiveSeatCountLabel(count: number): string {
  return `${count} active seat assignment${count === 1 ? "" : "s"}`;
}

function getProviderLabel(
  provider: OrganizationBillingHistoryEntry["provider"],
): string {
  switch (provider) {
    case "revenuecat":
      return "RevenueCat";
    case "stripe":
      return "Stripe";
    case "internal":
      return "Internal";
  }
}

function getCategoryLabel(
  category: OrganizationBillingHistoryEntry["category"],
): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function getBillingReasonLabel(reason: string): string {
  switch (reason) {
    case "subscription_create":
      return "Initial subscription";
    case "subscription_cycle":
      return "Subscription renewal";
    case "subscription_update":
      return "Subscription update";
    case "subscription_threshold":
      return "Billing threshold";
    case "quote_accept":
      return "Accepted quote";
    case "automatic_pending_invoice_item_invoice":
      return "Pending invoice items";
    default:
      return reason
        .toLowerCase()
        .split("_")
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
  }
}

function getPeriodLabel(entry: OrganizationBillingHistoryEntry): string | null {
  if (entry.periodStartsAt !== null && entry.periodEndsAt !== null) {
    return `Billing period: ${formatMiniAppDate(entry.periodStartsAt)} – ${formatMiniAppDate(entry.periodEndsAt)}`;
  }
  if (entry.periodStartsAt !== null) {
    return `Billing period starts: ${formatMiniAppDate(entry.periodStartsAt)}`;
  }
  if (entry.periodEndsAt !== null) {
    return `Billing period ends: ${formatMiniAppDate(entry.periodEndsAt)}`;
  }
  return null;
}

function Detail({ children }: { readonly children: string }) {
  return (
    <MiniAppRowText muted truncate={false}>
      {children}
    </MiniAppRowText>
  );
}

function RawIdentifier({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | null;
}) {
  if (value === null) {
    return null;
  }
  return <Detail>{`${label}: ${value}`}</Detail>;
}

function InvoiceFacts({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (entry.category !== "invoice") {
    return null;
  }
  const paidTotal = formatTotalAmount(entry.totalAmount, entry.currency);
  const rate = formatPrice(
    entry.unitAmount,
    entry.currency,
    entry.interval,
    entry.intervalCount,
  );
  return (
    <>
      <Detail>
        {paidTotal ? `Paid: ${paidTotal}` : "Paid total unavailable"}
      </Detail>
      {entry.billingReason !== null ? (
        <Detail>{`Invoice reason: ${getBillingReasonLabel(entry.billingReason)}`}</Detail>
      ) : null}
      <Detail>
        {entry.seatCount === null
          ? "Licensed seat count unavailable"
          : getOrgManagerSeatsLabel(entry.seatCount)}
      </Detail>
      <Detail>{rate ? `Plan price: ${rate}` : "Plan price unavailable"}</Detail>
    </>
  );
}

function LifecycleAvailability({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  if (
    entry.category !== "lifecycle" ||
    entry.totalAmount !== null ||
    entry.unitAmount !== null
  ) {
    return null;
  }
  return (
    <Detail>
      {entry.seatCount === null
        ? "Seat and cost details unavailable for this event"
        : "Cost details unavailable for this event"}
    </Detail>
  );
}

function AuditFields({
  entry,
}: {
  readonly entry: OrganizationBillingHistoryEntry;
}) {
  return (
    <>
      <Detail>{`Category: ${getCategoryLabel(entry.category)}`}</Detail>
      <Detail>{`Provider: ${getProviderLabel(entry.provider)}`}</Detail>
      <Detail>{`Outcome: ${entry.outcome}`}</Detail>
      <RawIdentifier label="Product ID" value={entry.productId} />
      <RawIdentifier label="Price ID" value={entry.priceId} />
      <RawIdentifier label="Transaction ID" value={entry.transactionId} />
      <RawIdentifier label="Subscription ID" value={entry.subscriptionId} />
      <RawIdentifier label="Invoice ID" value={entry.invoiceId} />
    </>
  );
}

/**
 * Billing facts shared by the friendly activity and raw event views. Totals
 * are rendered only from the provider's explicit `totalAmount`; the fixed-plan
 * price is deliberately kept separate and is never treated as the paid total.
 */
export function BillingHistoryEntryDetails({
  entry,
  includeAuditFields = false,
}: BillingHistoryEntryDetailsProps) {
  const period = getPeriodLabel(entry);

  return (
    <>
      <InvoiceFacts entry={entry} />
      {entry.category !== "invoice" && entry.seatCount !== null ? (
        <Detail>{getOrgManagerSeatsLabel(entry.seatCount)}</Detail>
      ) : null}
      {entry.seatDelta !== null ? (
        <Detail>{`Licensed seat change: ${getSignedCount(entry.seatDelta)}`}</Detail>
      ) : null}
      {entry.activeSeatCount !== null ? (
        <Detail>{getActiveSeatCountLabel(entry.activeSeatCount)}</Detail>
      ) : null}
      {entry.category === "seat" ? (
        <Detail>Cost unavailable for this seat event</Detail>
      ) : null}
      <LifecycleAvailability entry={entry} />
      {period ? <Detail>{period}</Detail> : null}
      {includeAuditFields ? <AuditFields entry={entry} /> : null}
    </>
  );
}
