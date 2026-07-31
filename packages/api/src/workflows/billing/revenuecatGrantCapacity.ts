import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import { organizations } from "@tearleads/api-shared/schema";
import { getSyncBillingTierForSeatCount } from "@tearleads/validators/billing";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import { eq } from "drizzle-orm";
import type { RevenueCatBillingTransition } from "../../billing/revenuecatWebhook";
import { listUsersReachableFromCurrentGroup } from "../organizations/principalReachability";

type RevenueCatGrantCapacityDisposition =
  | { readonly kind: "within_capacity" }
  | { readonly kind: "ignore"; readonly reason: string }
  | { readonly kind: "apply_without_reconciliation"; readonly reason: string };

/**
 * Compares a paid grant with the authoritative signed Members projection.
 * Stripe state above the largest sellable tier is malformed and is claimed for
 * operator repair. A native under-tier purchase is still honored: app-store
 * purchase and roster mutation cannot share a transaction, so dropping the
 * paid grant would charge the customer without granting service.
 */
export async function resolveRevenueCatGrantCapacity(input: {
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly transition: RevenueCatBillingTransition;
}): Promise<RevenueCatGrantCapacityDisposition> {
  if (input.transition.kind !== "grant") {
    return { kind: "within_capacity" };
  }
  const [organization] = await input.executor
    .select({ memberGroupId: organizations.memberGroupId })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) {
    return { kind: "within_capacity" };
  }
  const activeUserIds = await listUsersReachableFromCurrentGroup({
    executor: input.executor,
    groupId: organization.memberGroupId,
  });
  if (input.event.store?.toUpperCase() === "STRIPE") {
    return getSyncBillingTierForSeatCount(Math.max(1, activeUserIds.length))
      ? { kind: "within_capacity" }
      : {
          kind: "ignore",
          reason:
            "Stripe subscription cannot cover more than 10 active members",
        };
  }
  if (activeUserIds.length <= input.transition.fields.seatCount) {
    return { kind: "within_capacity" };
  }
  return {
    kind: "apply_without_reconciliation",
    reason:
      "Native subscription tier does not cover the organization's active members",
  };
}
