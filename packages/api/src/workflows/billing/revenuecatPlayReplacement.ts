import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import {
  organizationBilling,
  revenuecatWebhookEvents,
} from "@symcrypt/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { and, eq, isNull, or } from "drizzle-orm";
import {
  type RevenueCatApiDeps,
  verifyRevenueCatPlaySubscriptionReplacement,
} from "../../billing/revenueCatApi";

export interface VerifiedPlayReplacement {
  readonly appUserId: string;
  readonly organizationId: string;
  readonly predecessorSubscriptionId: string;
  readonly productId: string;
  readonly replacementSubscriptionId: string;
}

type PlayReplacementResolution =
  | { readonly kind: "none" }
  | { readonly kind: "unverified" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "verified";
      readonly replacement: VerifiedPlayReplacement;
    };

export function matchesVerifiedPlayReplacement(
  replacement: VerifiedPlayReplacement | null | undefined,
  input: VerifiedPlayReplacement,
): boolean {
  return Boolean(
    replacement &&
      replacement.appUserId === input.appUserId &&
      replacement.organizationId === input.organizationId &&
      replacement.predecessorSubscriptionId ===
        input.predecessorSubscriptionId &&
      replacement.productId === input.productId &&
      replacement.replacementSubscriptionId === input.replacementSubscriptionId,
  );
}

/** Resolves local intent, then asks RevenueCat to attest the Play lineage. */
export async function resolveVerifiedPlayReplacement(input: {
  readonly appUserId: string;
  readonly db: ApiDatabase;
  readonly deps?: RevenueCatApiDeps;
  readonly organizationId?: string;
  readonly productId: string;
  readonly replacementSubscriptionId: string;
}): Promise<PlayReplacementResolution> {
  const candidates = await input.db
    .select({
      organizationId: revenuecatWebhookEvents.organizationId,
      predecessorSubscriptionId:
        revenuecatWebhookEvents.sourceOriginalTransactionId,
    })
    .from(revenuecatWebhookEvents)
    .innerJoin(
      organizationBilling,
      and(
        eq(
          organizationBilling.organizationId,
          revenuecatWebhookEvents.organizationId,
        ),
        eq(organizationBilling.provider, "revenuecat"),
        eq(organizationBilling.providerCustomerId, input.appUserId),
        eq(
          organizationBilling.providerSubscriptionId,
          revenuecatWebhookEvents.sourceOriginalTransactionId,
        ),
      ),
    )
    .where(
      and(
        eq(revenuecatWebhookEvents.appUserId, input.appUserId),
        eq(revenuecatWebhookEvents.eventType, "PRODUCT_CHANGE"),
        eq(
          revenuecatWebhookEvents.originalTransactionId,
          revenuecatWebhookEvents.sourceOriginalTransactionId,
        ),
        eq(revenuecatWebhookEvents.store, "PLAY_STORE"),
        ...(input.organizationId
          ? [eq(revenuecatWebhookEvents.organizationId, input.organizationId)]
          : []),
        or(
          and(
            eq(revenuecatWebhookEvents.outcome, "applied"),
            eq(revenuecatWebhookEvents.productId, input.productId),
          ),
          and(
            eq(revenuecatWebhookEvents.outcome, "ignored"),
            isNull(revenuecatWebhookEvents.productId),
          ),
        ),
      ),
    )
    .groupBy(
      revenuecatWebhookEvents.organizationId,
      revenuecatWebhookEvents.sourceOriginalTransactionId,
    )
    .limit(2);
  const candidate = candidates[0];
  if (
    candidates.length !== 1 ||
    !candidate?.organizationId ||
    !candidate.predecessorSubscriptionId ||
    candidate.predecessorSubscriptionId === input.replacementSubscriptionId
  ) {
    return { kind: "none" };
  }
  const verification = await verifyRevenueCatPlaySubscriptionReplacement(
    {
      appUserId: input.appUserId,
      predecessorSubscriptionId: candidate.predecessorSubscriptionId,
      productId: input.productId,
      replacementSubscriptionId: input.replacementSubscriptionId,
    },
    input.deps,
  );
  if (verification.kind === "unavailable") return verification;
  if (verification.kind === "not_found") return { kind: "unverified" };
  return {
    kind: "verified",
    replacement: {
      appUserId: input.appUserId,
      organizationId: candidate.organizationId,
      predecessorSubscriptionId: candidate.predecessorSubscriptionId,
      productId: input.productId,
      replacementSubscriptionId: input.replacementSubscriptionId,
    },
  };
}

export async function resolveVerifiedWebhookPlayReplacement(input: {
  readonly db: ApiDatabase;
  readonly deps?: RevenueCatApiDeps;
  readonly event: RevenueCatWebhookEvent;
}): Promise<VerifiedPlayReplacement | null | "unavailable"> {
  const { event } = input;
  if (
    (event.type !== "INITIAL_PURCHASE" && event.type !== "RENEWAL") ||
    event.store?.toUpperCase() !== "PLAY_STORE" ||
    !event.original_transaction_id ||
    !event.product_id
  ) {
    return null;
  }
  const resolution = await resolveVerifiedPlayReplacement({
    appUserId: event.app_user_id,
    db: input.db,
    ...(input.deps ? { deps: input.deps } : {}),
    productId: event.product_id,
    replacementSubscriptionId: event.original_transaction_id,
  });
  if (resolution.kind === "unavailable" || resolution.kind === "unverified") {
    return "unavailable";
  }
  return resolution.kind === "verified" ? resolution.replacement : null;
}
