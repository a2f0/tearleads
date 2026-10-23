import type {
  RootOrganizationRevenuecatEvent,
  RootRevenuecatEvent,
} from "@tearleads/client-sdk";
import { isUuidV4String } from "@tearleads/validators/util";
import {
  MiniAppButton,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { formatBillingAmount } from "../../shared/billingFormatters";
import { formatRootTimestamp } from "../identities/rootDisplay";
import { RootFacts } from "../organizations/RootFacts";

type Delivery = RootRevenuecatEvent &
  Partial<Pick<RootOrganizationRevenuecatEvent, "role">>;

const date = (value: string | null) =>
  formatRootTimestamp(value, "Not recorded");

const ROLE_LABELS = {
  source: "Moved from this organization",
  target: "Applied to this organization",
} as const;

function summary(delivery: Delivery): string {
  const parts = [
    date(delivery.eventTimestamp),
    delivery.eventType,
    delivery.outcome,
  ];
  if (delivery.role === "source") parts.push("transferred away");
  if (delivery.role === undefined && delivery.organizationId === null) {
    parts.push("no organization");
  }
  return parts.join(" · ");
}

/**
 * Stored RevenueCat webhook deliveries, newest first, each expandable to the
 * evidence a support operator matches against RevenueCat and the store.
 */
export function RevenuecatDeliveries({
  deliveries,
  onSelectIdentity,
  onSelectOrganization,
}: {
  deliveries: ReadonlyArray<Delivery>;
  onSelectIdentity: (userId: string) => void;
  /** Offered where a delivery may belong to an organization not shown. */
  onSelectOrganization?: (organizationId: string) => void;
}) {
  return deliveries.map((delivery) => {
    const buyer = delivery.appUserId.trim().toLowerCase();
    const { organizationId } = delivery;
    return (
      <details className="root-console-history-entry" key={delivery.id}>
        <summary>{summary(delivery)}</summary>
        <RootFacts
          label={`RevenueCat delivery ${delivery.eventId}`}
          facts={[
            { label: "Event ID", value: delivery.eventId, copy: true },
            ...(delivery.role
              ? [{ label: "Role", value: ROLE_LABELS[delivery.role] }]
              : []),
            {
              label: "Organization",
              value: organizationId ?? "None resolved",
              copy: organizationId !== null,
            },
            {
              label: "Transferred from",
              value: delivery.sourceOrganizationId,
              copy: true,
            },
            { label: "App User ID", value: delivery.appUserId, copy: true },
            { label: "Store", value: delivery.store },
            { label: "Environment", value: delivery.environment },
            { label: "Product ID", value: delivery.productId, copy: true },
            { label: "Period type", value: delivery.periodType },
            {
              label: "Store price",
              value:
                formatBillingAmount(
                  delivery.priceInPurchasedCurrencyMinor,
                  delivery.currency,
                ) || null,
            },
            {
              label: "Transaction ID",
              value: delivery.transactionId,
              copy: true,
            },
            {
              label: "Original transaction ID",
              value: delivery.originalTransactionId,
              copy: true,
            },
            { label: "Purchased", value: date(delivery.purchasedAt) },
            { label: "Expires", value: date(delivery.expirationAt) },
            { label: "Received", value: date(delivery.createdAt) },
          ]}
        />
        <MiniAppToolbar wrap>
          {isUuidV4String(buyer) && (
            <MiniAppButton
              aria-label={`Open buyer identity ${buyer}`}
              onClick={() => onSelectIdentity(buyer)}
            >
              Open buyer identity
            </MiniAppButton>
          )}
          {onSelectOrganization && organizationId !== null && (
            <MiniAppButton
              aria-label={`Open organization billing ${organizationId}`}
              onClick={() => onSelectOrganization(organizationId)}
            >
              Open organization billing
            </MiniAppButton>
          )}
        </MiniAppToolbar>
      </details>
    );
  });
}
