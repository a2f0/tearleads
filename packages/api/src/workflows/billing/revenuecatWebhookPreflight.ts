import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type { RevenueCatWebhookEvent } from "@tearleads/validators/request";
import type { RevenueCatApiDeps } from "../../billing/revenueCatApi";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import {
  classifyRevenueCatEvent,
  type RevenueCatBillingTransition,
  SANDBOX_IGNORED_REASON,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { resolveVerifiedWebhookPlayReplacement } from "./revenuecatPlayReplacement";
import {
  type ImmutableStripeStoreOrgResolution,
  resolveImmutableStripeStoreOrganizationId,
} from "./revenuecatStripeResolution";

export interface RevenueCatWebhookWorkflowDeps {
  readonly env?: NodeJS.ProcessEnv;
  readonly revenuecat?: RevenueCatApiDeps;
  readonly stripe?: StripeApiDeps;
}

type RevenueCatWebhookPreflight =
  | {
      readonly kind: "retry";
      readonly reason: string;
    }
  | {
      readonly allowSandboxEvents: boolean;
      readonly kind: "continue";
      readonly stripeResolution: ImmutableStripeStoreOrgResolution;
      readonly stripeTierUnresolved: boolean;
      readonly transition: RevenueCatBillingTransition;
      readonly verifiedReplacement: Exclude<
        Awaited<ReturnType<typeof resolveVerifiedWebhookPlayReplacement>>,
        "unavailable"
      >;
    };

export async function resolveRevenueCatWebhookPreflight(input: {
  readonly db: ApiDatabase;
  readonly deps: RevenueCatWebhookWorkflowDeps;
  readonly event: RevenueCatWebhookEvent;
  readonly now: Date;
}): Promise<RevenueCatWebhookPreflight> {
  const allowSandboxEvents = allowsRevenueCatSandboxEvents(
    input.deps.env ?? process.env,
  );
  const classificationOptions = {
    allowSandboxEvents,
    ...(input.event.store?.toUpperCase() === "STRIPE"
      ? { stripeSeatCount: 1 }
      : {}),
  };
  const initialTransition = classifyRevenueCatEvent(
    input.event,
    input.now,
    classificationOptions,
  );
  if (
    initialTransition.kind === "ignore" &&
    initialTransition.reason === SANDBOX_IGNORED_REASON
  ) {
    console.warn(
      `RevenueCat event ${input.event.id} (${input.event.type}, store=${input.event.store ?? "unknown"}, environment=${input.event.environment}) ignored: ${initialTransition.reason}`,
    );
  }
  const stripeResolution =
    initialTransition.kind === "ignore"
      ? ({ kind: "none" } satisfies ImmutableStripeStoreOrgResolution)
      : await resolveImmutableStripeStoreOrganizationId(
          input.db,
          input.event,
          input.deps.stripe ?? {},
        );
  if (stripeResolution.kind === "error") {
    return {
      kind: "retry",
      reason: "Stripe subscription lookup failed for a Stripe-store event",
    };
  }
  const stripeTierUnresolved =
    initialTransition.kind === "grant" &&
    stripeResolution.kind === "resolved" &&
    (stripeResolution.priceId === null || stripeResolution.seatCount === null);
  const transition =
    stripeResolution.kind === "resolved"
      ? classifyRevenueCatEvent(input.event, input.now, {
          ...classificationOptions,
          ...(stripeResolution.priceId
            ? { stripePriceId: stripeResolution.priceId }
            : {}),
          stripeSeatCount: stripeResolution.seatCount ?? 1,
        })
      : initialTransition;
  const verifiedReplacement =
    transition.kind === "grant"
      ? await resolveVerifiedWebhookPlayReplacement({
          db: input.db,
          deps:
            input.deps.revenuecat ??
            (input.deps.env ? { env: input.deps.env } : {}),
          event: input.event,
        })
      : null;
  if (verifiedReplacement === "unavailable") {
    return {
      kind: "retry",
      reason: "RevenueCat could not verify Play replacement lineage",
    };
  }
  return {
    allowSandboxEvents,
    kind: "continue",
    stripeResolution,
    stripeTierUnresolved,
    transition,
    verifiedReplacement,
  };
}
