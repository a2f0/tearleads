import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import {
  isRevenueCatGrantEventType,
  SANDBOX_IGNORED_REASON,
} from "../../billing/revenuecatWebhook";
import { DEFERRED_NATIVE_DOWNGRADE_REASON } from "./revenuecatGrantCapacity";

const ROUTINE_GRANT_IGNORE_REASONS = new Set([
  "A newer billing event has already been applied",
  "Grant event period has already expired",
  DEFERRED_NATIVE_DOWNGRADE_REASON,
  SANDBOX_IGNORED_REASON,
]);

/** Alerts on rejected paid grants while leaving routine redeliveries quiet. */
export function logUnappliedRevenueCatGrant(
  event: RevenueCatWebhookEvent,
  outcome: { readonly status: string; readonly reason?: string },
): void {
  if (
    outcome.status !== "ignored" ||
    typeof outcome.reason !== "string" ||
    !isRevenueCatGrantEventType(event.type) ||
    ROUTINE_GRANT_IGNORE_REASONS.has(outcome.reason)
  ) {
    return;
  }
  console.error(
    `RevenueCat paid grant ${event.id} was not applied: ${outcome.reason}`,
  );
}
