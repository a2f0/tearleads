import {
  NATIVE_SUBSCRIPTION_STORES,
  type NativeSubscriptionStore,
} from "@tearleads/validators/billing";
import type {
  RevenueCatIncomingWebhookEvent,
  RevenueCatTransferWebhookEvent,
} from "@tearleads/validators/request";
import { isRevenueCatTransferWebhookEvent } from "@tearleads/validators/request";
import { isUuidV4String } from "@tearleads/validators/util";
import { isNativeSubscriptionMoveConflict } from "../../billing/databaseErrors";
import {
  fetchActiveRevenueCatNativeSubscription,
  type RevenueCatApiDeps,
} from "../../billing/revenueCatApi";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import {
  resolvePersonalOrganizationForUser,
  runClaimNativeSubscriptionWorkflow,
} from "../../workflows/billing/nativeSubscriptionClaim";
import {
  type RevenueCatWebhookOutcome,
  runRevenueCatWebhookWorkflow,
} from "../../workflows/billing/revenuecatWebhook";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";

/**
 * Applies a validated RevenueCat webhook event to organization sync billing.
 * Authentication (the shared-secret header) is enforced at the route boundary;
 * this only runs once the payload is trusted and well-formed.
 */
export async function processRevenueCatWebhook(
  runtime: ApiServiceRuntime,
  event: RevenueCatIncomingWebhookEvent,
  deps: RevenueCatApiDeps = {},
): Promise<RevenueCatWebhookOutcome> {
  if (isRevenueCatTransferWebhookEvent(event)) {
    return processRevenueCatTransfer(runtime, event, deps);
  }
  return runRevenueCatWebhookWorkflow(runtime.db, event, new Date(), {
    ...(deps.env ? { env: deps.env } : {}),
  });
}

function nativeStoreFromTransfer(
  event: RevenueCatTransferWebhookEvent,
): NativeSubscriptionStore | null {
  const store = event.store?.toLowerCase();
  return store === "app_store" ||
    store === "play_store" ||
    store === "test_store"
    ? store
    : null;
}

type ActiveSubscriptionLookup = Awaited<
  ReturnType<typeof fetchActiveRevenueCatNativeSubscription>
>;

async function resolveTransferredSubscription(input: {
  readonly appUserId: string;
  readonly deps: RevenueCatApiDeps;
  readonly store: NativeSubscriptionStore | null;
}): Promise<ActiveSubscriptionLookup> {
  const stores = input.store ? [input.store] : NATIVE_SUBSCRIPTION_STORES;
  const results = await Promise.all(
    stores.map((store) =>
      fetchActiveRevenueCatNativeSubscription(
        input.appUserId,
        store,
        input.deps,
      ),
    ),
  );
  let found: ActiveSubscriptionLookup | null = null;
  for (const result of results) {
    if (result.kind === "ambiguous") return result;
    if (result.kind === "unavailable") return result;
    if (result.kind !== "found") continue;
    if (found) return { kind: "ambiguous" };
    found = result;
  }
  return found ?? { kind: "not_found" };
}

async function resolveTransferDestination(
  runtime: ApiServiceRuntime,
  appUserIds: readonly string[],
): Promise<
  | { readonly appUserId: string; readonly organizationId: string }
  | null
  | "ambiguous"
> {
  const destinations: Array<{
    appUserId: string;
    organizationId: string;
  }> = [];
  for (const appUserId of new Set(appUserIds)) {
    if (!isUuidV4String(appUserId)) continue;
    const organizationId = await resolvePersonalOrganizationForUser(
      runtime.db,
      appUserId,
    );
    if (organizationId) destinations.push({ appUserId, organizationId });
  }
  if (destinations.length > 1) return "ambiguous";
  return destinations[0] ?? null;
}

async function processRevenueCatTransfer(
  runtime: ApiServiceRuntime,
  event: RevenueCatTransferWebhookEvent,
  deps: RevenueCatApiDeps,
): Promise<RevenueCatWebhookOutcome> {
  if (
    event.environment?.toLowerCase() === "sandbox" &&
    !allowsRevenueCatSandboxEvents(deps.env ?? process.env)
  ) {
    return { status: "ignored", reason: "Sandbox RevenueCat event ignored" };
  }
  const store = nativeStoreFromTransfer(event);
  if (
    store === "test_store" &&
    !allowsRevenueCatSandboxEvents(deps.env ?? process.env)
  ) {
    return { status: "ignored", reason: "Test Store transfer ignored" };
  }
  if (event.store !== undefined && event.store !== null && !store) {
    return { status: "ignored", reason: "Transfer store is not supported" };
  }
  const destination = await resolveTransferDestination(
    runtime,
    event.transferred_to,
  );
  if (destination === "ambiguous") {
    return {
      status: "retry",
      reason: "Transfer has more than one registered destination",
    };
  }
  if (!destination) {
    return {
      status: "ignored",
      reason: "Transfer destination is not a Tearleads user",
    };
  }
  const resolved = await resolveTransferredSubscription({
    appUserId: destination.appUserId,
    deps,
    store,
  });
  if (resolved.kind === "not_found") {
    return {
      status: "ignored",
      reason: "Transferred subscription is not active",
    };
  }
  if (resolved.kind !== "found") {
    return {
      status: "retry",
      reason: `Transferred subscription verification is ${resolved.kind}`,
    };
  }
  let claimed: Awaited<ReturnType<typeof runClaimNativeSubscriptionWorkflow>>;
  try {
    claimed = await runClaimNativeSubscriptionWorkflow({
      appUserId: destination.appUserId,
      auditEvent: {
        eventId: event.id,
        eventTimestamp: new Date(event.event_timestamp_ms),
      },
      db: runtime.db,
      organizationId: destination.organizationId,
      requireSessionAccess: false,
      sourceId: event.id,
      subscription: resolved.subscription,
    });
  } catch (error) {
    if (isNativeSubscriptionMoveConflict(error)) {
      return {
        status: "retry",
        reason: "Native subscription ownership changed concurrently",
      };
    }
    if (error instanceof OrganizationManagerError) {
      return { status: "ignored", reason: error.message };
    }
    throw error;
  }
  return claimed.duplicate
    ? { status: "duplicate" }
    : {
        billingStatus: "active",
        organizationId: destination.organizationId,
        status: "applied",
      };
}
