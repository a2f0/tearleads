import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import {
  type RevenueCatWebhookOutcome,
  runRevenueCatWebhookWorkflow,
} from "../../workflows/billing/revenuecatWebhook";
import type { ApiServiceRuntime } from "../runtime";

/**
 * Applies a validated RevenueCat webhook event to organization sync billing.
 * Authentication (the shared-secret header) is enforced at the route boundary;
 * this only runs once the payload is trusted and well-formed.
 */
export async function processRevenueCatWebhook(
  runtime: ApiServiceRuntime,
  event: RevenueCatWebhookEvent,
): Promise<RevenueCatWebhookOutcome> {
  return runRevenueCatWebhookWorkflow(runtime.db, event);
}
