import {
  NATIVE_SUBSCRIPTION_STORES,
  type NativeSubscriptionStore,
} from "@symcrypt/validators/billing";
import type {
  RevenueCatIncomingWebhookEvent,
  RevenueCatTransferWebhookEvent,
} from "@symcrypt/validators/request";
import { isRevenueCatTransferWebhookEvent } from "@symcrypt/validators/request";
import { isUuidV4String } from "@symcrypt/validators/util";
import { isNativeSubscriptionMoveConflict } from "../../billing/databaseErrors";
import {
  type ActiveNativeSubscription,
  fetchActiveRevenueCatNativeSubscription,
  type RevenueCatApiDeps,
} from "../../billing/revenueCatApi";
import { allowsRevenueCatSandboxEvents } from "../../billing/revenueCatConfig";
import {
  NativeSubscriptionTransferAwaitingClaimError,
  resolveNativeSubscriptionOrganizationForUser,
  runClaimNativeSubscriptionWorkflow,
} from "../../workflows/billing/nativeSubscriptionClaim";
import { runRecordIgnoredRevenueCatTransferWorkflow } from "../../workflows/billing/revenuecatTransferAudit";
import {
  type RevenueCatWebhookOutcome,
  runRevenueCatWebhookWorkflow,
} from "../../workflows/billing/revenuecatWebhook";
import { OrganizationManagerError } from "../../workflows/organizations/errors";
import type { ApiServiceRuntime } from "../runtime";

const TRANSFER_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    if (result.kind === "customer_not_found") return result;
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
): Promise<TransferDestination | null | "ambiguous"> {
  const destinations: TransferDestination[] = [];
  for (const appUserId of new Set(appUserIds)) {
    if (!isUuidV4String(appUserId)) continue;
    const organizationId = await resolveNativeSubscriptionOrganizationForUser(
      runtime.db,
      appUserId,
    );
    if (organizationId === "ambiguous") return "ambiguous";
    if (organizationId) destinations.push({ appUserId, organizationId });
  }
  if (destinations.length > 1) return "ambiguous";
  return destinations[0] ?? null;
}

interface TransferDestination {
  readonly appUserId: string;
  readonly organizationId: string;
}

async function ignoreRevenueCatTransfer(input: {
  readonly destination?: TransferDestination;
  readonly event: RevenueCatTransferWebhookEvent;
  readonly reason: string;
  readonly runtime: ApiServiceRuntime;
}): Promise<RevenueCatWebhookOutcome> {
  const recorded = await runRecordIgnoredRevenueCatTransferWorkflow({
    appUserId:
      input.destination?.appUserId ??
      input.event.transferred_to[0] ??
      "unresolved",
    db: input.runtime.db,
    event: input.event,
    organizationId: input.destination?.organizationId ?? null,
  });
  return recorded
    ? { reason: input.reason, status: "ignored" }
    : { status: "duplicate" };
}

async function deferUnconfirmedTransfer(input: {
  readonly destination: TransferDestination;
  readonly event: RevenueCatTransferWebhookEvent;
  readonly reason: string;
  readonly runtime: ApiServiceRuntime;
}): Promise<RevenueCatWebhookOutcome> {
  if (Date.now() - input.event.event_timestamp_ms <= TRANSFER_CLAIM_WINDOW_MS) {
    return { reason: input.reason, status: "retry" };
  }
  return ignoreRevenueCatTransfer({
    destination: input.destination,
    event: input.event,
    reason: "Transfer was not confirmed by an authenticated native claim",
    runtime: input.runtime,
  });
}

async function claimTransferredSubscription(input: {
  readonly destination: TransferDestination;
  readonly event: RevenueCatTransferWebhookEvent;
  readonly runtime: ApiServiceRuntime;
  readonly subscription: ActiveNativeSubscription;
}): Promise<RevenueCatWebhookOutcome> {
  let claimed: Awaited<ReturnType<typeof runClaimNativeSubscriptionWorkflow>>;
  try {
    claimed = await runClaimNativeSubscriptionWorkflow({
      appUserId: input.destination.appUserId,
      auditEvent: {
        eventId: input.event.id,
        eventTimestamp: new Date(input.event.event_timestamp_ms),
      },
      db: input.runtime.db,
      organizationId: input.destination.organizationId,
      requireExistingBinding: true,
      requireSessionAccess: false,
      sourceId: input.event.id,
      subscription: input.subscription,
    });
  } catch (error) {
    if (error instanceof NativeSubscriptionTransferAwaitingClaimError) {
      return deferUnconfirmedTransfer({
        destination: input.destination,
        event: input.event,
        reason: "Transfer awaits an authenticated native subscription claim",
        runtime: input.runtime,
      });
    }
    if (isNativeSubscriptionMoveConflict(error)) {
      return {
        reason: "Native subscription ownership changed concurrently",
        status: "retry",
      };
    }
    if (error instanceof OrganizationManagerError) {
      return ignoreRevenueCatTransfer({
        destination: input.destination,
        event: input.event,
        reason: error.message,
        runtime: input.runtime,
      });
    }
    throw error;
  }
  return claimed.duplicate
    ? { status: "duplicate" }
    : {
        billingStatus: "active",
        organizationId: input.destination.organizationId,
        status: "applied",
      };
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
    return ignoreRevenueCatTransfer({
      event,
      reason: "Sandbox RevenueCat event ignored",
      runtime,
    });
  }
  const store = nativeStoreFromTransfer(event);
  if (
    store === "test_store" &&
    !allowsRevenueCatSandboxEvents(deps.env ?? process.env)
  ) {
    return ignoreRevenueCatTransfer({
      event,
      reason: "Test Store transfer ignored",
      runtime,
    });
  }
  if (event.store !== undefined && event.store !== null && !store) {
    return ignoreRevenueCatTransfer({
      event,
      reason: "Transfer store is not supported",
      runtime,
    });
  }
  const destination = await resolveTransferDestination(
    runtime,
    event.transferred_to,
  );
  if (destination === "ambiguous") {
    return ignoreRevenueCatTransfer({
      event,
      reason: "Transfer has more than one registered destination",
      runtime,
    });
  }
  if (!destination) {
    return ignoreRevenueCatTransfer({
      event,
      reason: "Transfer destination is not a SymCrypt user",
      runtime,
    });
  }
  const resolved = await resolveTransferredSubscription({
    appUserId: destination.appUserId,
    deps,
    store,
  });
  if (resolved.kind === "not_found") {
    return ignoreRevenueCatTransfer({
      destination,
      event,
      reason: "Transferred subscription is not active",
      runtime,
    });
  }
  if (resolved.kind === "customer_not_found") {
    return deferUnconfirmedTransfer({
      destination,
      event,
      reason: "Transferred subscription has not propagated to RevenueCat",
      runtime,
    });
  }
  if (resolved.kind !== "found") {
    const reason = `Transferred subscription verification is ${resolved.kind}`;
    return resolved.kind === "ambiguous"
      ? ignoreRevenueCatTransfer({ destination, event, reason, runtime })
      : { reason, status: "retry" };
  }
  return claimTransferredSubscription({
    destination,
    event,
    runtime,
    subscription: resolved.subscription,
  });
}
