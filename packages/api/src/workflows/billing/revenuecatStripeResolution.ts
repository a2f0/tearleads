import type {
  ApiDatabase,
  DatabaseSession,
} from "@symcrypt/api-shared/postgres";
import {
  type OrganizationBillingProvider,
  type OrganizationBillingStatus,
  organizationBillingStripeSeats,
} from "@symcrypt/api-shared/schema";
import type { RevenueCatWebhookEvent } from "@symcrypt/validators/request";
import { eq, inArray, or } from "drizzle-orm";
import {
  resolveOrganizationIdFromTransactionMetadata,
  resolveStripeStoreOrganizationId,
} from "../../billing/revenuecatWebhook";
import type { StripeApiDeps } from "../../billing/stripeApi";
import { getSyncBillingTierForStripePrice } from "../../billing/stripeHttp";

type StripeResolutionSource = "durable" | "provider";

export type ImmutableStripeStoreOrgResolution =
  | {
      kind: "resolved";
      identifiers: readonly string[];
      organizationId: string;
      priceId: string | null;
      seatCount: number | null;
      source: StripeResolutionSource;
    }
  | { kind: "none" }
  | { kind: "error" };

export interface LockedBillingIdentity {
  readonly checkoutAttemptExpiresAt: Date | null;
  readonly checkoutAttemptId: string | null;
  readonly provider: OrganizationBillingProvider | null;
  readonly providerCustomerId: string | null;
  readonly providerProductId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly seatCount: number;
  readonly status: OrganizationBillingStatus;
}

interface StripeSeatBindingIdentity {
  readonly subscriptionId: string | null;
  readonly subscriptionItemId: string | null;
}

function stripeEventIdentifiers(event: RevenueCatWebhookEvent): string[] {
  return [event.original_transaction_id, event.transaction_id].filter(
    (value): value is string => typeof value === "string",
  );
}

function bindingMatchesIdentifiers(
  binding: StripeSeatBindingIdentity,
  identifiers: readonly string[],
): boolean {
  const subscriptionIds = identifiers.filter((value) =>
    value.startsWith("sub_"),
  );
  const itemIds = identifiers.filter((value) => value.startsWith("si_"));
  const hasExactMatch =
    subscriptionIds.includes(binding.subscriptionId ?? "") ||
    itemIds.includes(binding.subscriptionItemId ?? "");
  return (
    hasExactMatch &&
    subscriptionIds.every((value) => value === binding.subscriptionId) &&
    itemIds.every((value) => value === binding.subscriptionItemId)
  );
}

async function resolveDurableStripeStoreOrganizationId(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps,
): Promise<ImmutableStripeStoreOrgResolution> {
  if (event.store?.toUpperCase() !== "STRIPE") {
    return { kind: "none" };
  }
  const identifiers = [...new Set(stripeEventIdentifiers(event))];
  if (identifiers.length === 0) {
    return { kind: "error" };
  }
  const rows = await db
    .select({
      organizationId: organizationBillingStripeSeats.organizationId,
      priceId: organizationBillingStripeSeats.priceId,
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(
      or(
        inArray(organizationBillingStripeSeats.subscriptionId, identifiers),
        inArray(organizationBillingStripeSeats.subscriptionItemId, identifiers),
      ),
    )
    .limit(2);
  const binding = rows[0];
  if (rows.length === 0) {
    return { kind: "none" };
  }
  if (
    rows.length !== 1 ||
    !binding ||
    !bindingMatchesIdentifiers(binding, identifiers)
  ) {
    return { kind: "error" };
  }
  const tier = getSyncBillingTierForStripePrice(binding.priceId, deps);
  return {
    identifiers,
    kind: "resolved",
    organizationId: binding.organizationId,
    priceId: binding.priceId,
    seatCount: tier?.seatLimit ?? null,
    source: "durable",
  };
}

/** Resolves an immutable candidate; locked database validation happens later. */
export async function resolveImmutableStripeStoreOrganizationId(
  db: ApiDatabase,
  event: RevenueCatWebhookEvent,
  deps: StripeApiDeps,
): Promise<ImmutableStripeStoreOrgResolution> {
  const durableResolution = await resolveDurableStripeStoreOrganizationId(
    db,
    event,
    deps,
  );
  if (durableResolution.kind !== "none") {
    return durableResolution;
  }
  if (event.store?.toUpperCase() !== "STRIPE") {
    return { kind: "none" };
  }

  const identifiers = [...new Set(stripeEventIdentifiers(event))];
  const metadataOrganizationId =
    resolveOrganizationIdFromTransactionMetadata(event);

  const providerResolution = await resolveStripeStoreOrganizationId(
    event,
    deps,
  );
  if (providerResolution.kind !== "resolved") {
    return providerResolution;
  }
  if (
    metadataOrganizationId &&
    metadataOrganizationId !== providerResolution.organizationId
  ) {
    return { kind: "error" };
  }
  return {
    identifiers,
    kind: "resolved",
    organizationId: providerResolution.organizationId,
    priceId: providerResolution.priceId,
    seatCount: providerResolution.seatCount,
    source: "provider",
  };
}

async function readCurrentStripeBinding(
  executor: DatabaseSession,
  organizationId: string,
): Promise<StripeSeatBindingIdentity | undefined> {
  const [binding] = await executor
    .select({
      subscriptionId: organizationBillingStripeSeats.subscriptionId,
      subscriptionItemId: organizationBillingStripeSeats.subscriptionItemId,
    })
    .from(organizationBillingStripeSeats)
    .where(eq(organizationBillingStripeSeats.organizationId, organizationId))
    .limit(1);
  return binding;
}

/**
 * Revalidates a pre-transaction candidate after the billing row is locked.
 * Stripe binding writers take the same billing lock before changing the outbox,
 * so this read cannot race a subscription replacement.
 */
export async function validateLockedStripeStoreOrganizationId(input: {
  readonly billing: LockedBillingIdentity;
  readonly event: RevenueCatWebhookEvent;
  readonly executor: DatabaseSession;
  readonly resolution: Extract<
    ImmutableStripeStoreOrgResolution,
    { kind: "resolved" }
  >;
}): Promise<boolean> {
  const currentBinding = await readCurrentStripeBinding(
    input.executor,
    input.resolution.organizationId,
  );
  if (
    currentBinding &&
    bindingMatchesIdentifiers(currentBinding, input.resolution.identifiers)
  ) {
    return true;
  }
  if (
    input.resolution.source === "durable" ||
    currentBinding?.subscriptionId ||
    currentBinding?.subscriptionItemId
  ) {
    return false;
  }

  const [identifier] = input.resolution.identifiers;
  if (!identifier) {
    return false;
  }
  return (
    (input.billing.providerSubscriptionId === null ||
      input.billing.providerSubscriptionId === identifier) &&
    (input.billing.providerCustomerId === null ||
      input.billing.providerCustomerId === input.event.app_user_id)
  );
}
