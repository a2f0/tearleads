import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  organizationBilling,
  organizationBillingStripeSeats,
} from "@tearleads/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import { reconcileOrganizationBillingSeats } from "./organizationSeats";
import { isRecognizedNativeRevenueCatStore } from "./revenuecatBuyerPolicy";
import type {
  AppliedRevenueCatTransition,
  RevenueCatWebhookOutcome,
} from "./revenuecatWebhookTypes";

export async function applyRevenueCatTransition(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly now: Date;
  readonly organizationId: string;
  readonly preserveStripeBinding: boolean;
  readonly reconcileSeats: boolean;
  readonly transition: AppliedRevenueCatTransition;
}): Promise<RevenueCatWebhookOutcome> {
  await input.executor
    .update(organizationBilling)
    .set({ ...input.transition.fields, updatedAt: input.now })
    .where(eq(organizationBilling.organizationId, input.organizationId));
  if (
    input.transition.kind === "grant" &&
    isRecognizedNativeRevenueCatStore(input.event.store)
  ) {
    if (input.preserveStripeBinding) {
      // Keep identity for final-event attribution. A null Price quarantines
      // seat sync while the native product controls entitlement and capacity.
      await input.executor
        .update(organizationBillingStripeSeats)
        .set({
          inFlightOperationId: null,
          inFlightTargetCapacity: null,
          leaseExpiresAt: null,
          leaseId: null,
          nextAttemptAt: null,
          priceId: null,
          updatedAt: input.now,
        })
        .where(
          eq(
            organizationBillingStripeSeats.organizationId,
            input.organizationId,
          ),
        );
    } else {
      await input.executor
        .delete(organizationBillingStripeSeats)
        .where(
          eq(
            organizationBillingStripeSeats.organizationId,
            input.organizationId,
          ),
        );
    }
  }
  if (input.transition.kind === "grant" && input.reconcileSeats) {
    await reconcileOrganizationBillingSeats({
      executor: input.executor,
      now: input.now,
      organizationId: input.organizationId,
      source: {
        sourceId: input.event.id,
        sourceType: "provider_event",
      },
    });
  }
  return {
    status: "applied",
    organizationId: input.organizationId,
    billingStatus: input.transition.fields.status,
  };
}
