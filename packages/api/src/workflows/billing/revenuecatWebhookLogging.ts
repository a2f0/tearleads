import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import {
  isRevenueCatGrantEventType,
  SANDBOX_IGNORED_REASON,
} from "../../billing/revenuecatWebhook";

const ROUTINE_GRANT_IGNORE_REASONS = new Set([
  "A newer billing event has already been applied",
  "Grant event period has already expired",
  SANDBOX_IGNORED_REASON,
]);

/** Alerts on rejected paid events while leaving routine redeliveries quiet. */
export function logUnappliedRevenueCatGrant(
  event: RevenueCatWebhookEvent,
  outcome: { readonly status: string; readonly reason?: string },
): void {
  if (
    outcome.status !== "ignored" ||
    typeof outcome.reason !== "string" ||
    (!isRevenueCatGrantEventType(event.type) &&
      event.type !== "PRODUCT_CHANGE") ||
    ROUTINE_GRANT_IGNORE_REASONS.has(outcome.reason)
  ) {
    return;
  }
  const paidEventKind =
    event.type === "PRODUCT_CHANGE" ? "product change" : "grant";
  console.error(
    `RevenueCat paid ${paidEventKind} ${event.id} was not applied: ${outcome.reason}`,
  );
}
