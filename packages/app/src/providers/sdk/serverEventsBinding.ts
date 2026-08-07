import type { Tearleads } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty, isUuidV4String } from "@tearleads/validators/util";
import { useEffect, useState } from "react";
import type { SubscribeConnectionRefreshFn } from "../../host/AppHostConfig";
import {
  type ContainerInterestDeclaration,
  startContainerInterestDeclaration,
} from "./containerInterest";
import {
  attachOrganizationReadModelSocket,
  handleOrganizationReadModelHint,
  handleOrganizationReadModelInterestAcknowledgement,
} from "./organizationReadModelRealtime";
import { startServerEventsConnectionLoop } from "./serverEventsConnectionLoop";

export { startContainerInterestDeclaration } from "./containerInterest";

function isServerEvent(value: unknown): value is {
  type: string;
  [key: string]: unknown;
} {
  return isPlainObject(value) && hasStringProperty(value, "type");
}

// The server's reconnect baseline frame: the container ids it already holds for
// this session. Returns the (possibly empty) set, or null when not that frame.
function readInterestStateContainerIds(value: unknown): string[] | null {
  if (!isServerEvent(value) || value.type !== "interest_state") {
    return null;
  }
  const containerIds = Reflect.get(value, "containerIds");
  if (!Array.isArray(containerIds)) {
    return [];
  }
  return containerIds.filter((id): id is string => typeof id === "string");
}

function readContainerInterestAcknowledgement(value: unknown): string | null {
  if (!isServerEvent(value) || value.type !== "known_containers_ack") {
    return null;
  }
  const declarationId = Reflect.get(value, "declarationId");
  return typeof declarationId === "string" &&
    declarationId.length > 0 &&
    declarationId.length <= 128
    ? declarationId
    : null;
}

// The server's "a container's access changed, resync it" signal.
function readResyncRequiredContainerId(value: unknown): string | null {
  if (!isServerEvent(value) || value.type !== "resync_required") {
    return null;
  }
  const containerId = Reflect.get(value, "containerId");
  return typeof containerId === "string" && containerId.length > 0
    ? containerId
    : null;
}

// The server's "a container was just shared with you" signal. It carries no
// container id (the recipient does not know the container yet, so it is routed
// by user, not interest); the client reacts by re-listing root containers.
function isSharedWithYouEvent(value: unknown): boolean {
  return isServerEvent(value) && value.type === "shared_with_you";
}

function readOrganizationReadModelControl(
  value: unknown,
): { organizationId: string; originatedFromSession: boolean } | null {
  if (
    !isServerEvent(value) ||
    (value.type !== "organization_read_model_changed" &&
      value.type !== "organization_read_model_access_revoked")
  ) {
    return null;
  }
  const organizationId = Reflect.get(value, "organizationId");
  if (typeof organizationId !== "string" || !isUuidV4String(organizationId)) {
    return null;
  }
  if (value.type === "organization_read_model_access_revoked") {
    return { organizationId, originatedFromSession: false };
  }
  const originatedFromSession = Reflect.get(value, "originatedFromSession");
  return typeof originatedFromSession === "boolean"
    ? { organizationId, originatedFromSession }
    : null;
}

function readOrganizationInterestAcknowledgement(value: unknown): {
  readonly authorized: boolean;
  readonly declarationId: string;
  readonly organizationId: string | null;
} | null {
  if (!isServerEvent(value) || value.type !== "known_organizations_ack") {
    return null;
  }
  const authorized = Reflect.get(value, "authorized");
  const declarationId = Reflect.get(value, "declarationId");
  const organizationId = Reflect.get(value, "organizationId");
  if (
    typeof authorized !== "boolean" ||
    typeof declarationId !== "string" ||
    declarationId.length === 0 ||
    declarationId.length > 128 ||
    (organizationId !== null &&
      (typeof organizationId !== "string" || !isUuidV4String(organizationId)))
  ) {
    return null;
  }
  return { authorized, declarationId, organizationId };
}

// Force a fresh access check + tree re-list for a container the server flagged.
// HTTP is the source of access truth: a now-unauthorized container drops out of
// the tree (and interest); a still-authorized one is re-validated.
export async function resyncContainerAccess(
  tearleads: Tearleads,
  containerId: string,
): Promise<void> {
  const resyncTasks: Promise<unknown>[] = [];
  try {
    // Re-validate just the affected container (force re-discovery), not the
    // whole tree; a single access change should not re-sync everything.
    tearleads.deviceFirst
      .open()
      .reconciler.enqueueContainer(containerId, "active", true);
  } catch {
    // Reconciler unavailable (runtime not ready); the refresh below still runs.
  }
  try {
    // Re-list the root lane plus the flagged container's own parent lane, NOT the
    // whole tree. The reconciler.enqueueContainer above re-validates the flagged
    // container's contents; the root lane surfaces a new top-level grant; and the
    // parent lane applies the flagged container's tombstone when it was deleted —
    // a deleted nested container's tombstone is only returned by its parent lane
    // (rootDiscoveryVisible=false), never the root lane. The all-parent crawl
    // (openTree().refresh()) is reserved for explicit user refresh. Per
    // resync_required a single access change used to re-list every parent lane on
    // every event, which is the bulk of the membership-change request storm
    // (#1281); scoping to root + the one relevant parent lane keeps the
    // revocation/discovery/deletion guarantees while dropping that crawl.
    const tree = tearleads.deviceFirst.open().containerStore;
    const flaggedParentId =
      tree.getSnapshot().nodes.find((node) => node.id === containerId)
        ?.parentId ?? null;
    resyncTasks.push(
      tree.refreshRootLane(
        flaggedParentId === null ? undefined : { parentIds: [flaggedParentId] },
      ),
    );
  } catch {
    // Runtime not ready; the next reconnect re-validates from a ready tree.
  }
  await Promise.allSettled(resyncTasks);
}

// Tracks an in-flight root re-list per Tearleads instance (dual-pane gives each
// pane its own instance) so a burst of "shared_with_you" events coalesces into a
// single sweep plus at most one trailing sweep, instead of firing concurrently.
const activeRootResyncByInstance = new WeakMap<
  Tearleads,
  { readonly promise: Promise<void>; pending: boolean }
>();

// Re-list the user's root containers so a newly shared container appears without
// a manual refresh. The share has no node in the local tree to target yet, so
// this drives the root lane (the same sweep Explorer runs on open) rather than
// resyncContainerAccess's single-container path.
//
// The reconciler already single-flights concurrent sweeps, so this never issues
// redundant parallel re-lists; the coalescing here additionally schedules one
// trailing sweep when events land while a sweep is in flight, so a share whose
// grant commits after the active sweep already fetched the root list is still
// picked up rather than waiting for the next event or manual refresh.
async function resyncRootContainers(tearleads: Tearleads): Promise<void> {
  const active = activeRootResyncByInstance.get(tearleads);
  if (active) {
    active.pending = true;
    return active.promise;
  }

  const runSweep = async (): Promise<void> => {
    try {
      await tearleads.deviceFirst
        .open()
        .reconciler.reconcileRootContainersNow();
    } catch {
      // Runtime not ready; the next reconnect or manual refresh re-lists roots.
    }
  };

  const state = { pending: false, promise: runSweep() };
  activeRootResyncByInstance.set(tearleads, state);
  await state.promise;
  activeRootResyncByInstance.delete(tearleads);

  if (state.pending) {
    await resyncRootContainers(tearleads);
  }
}

export function routeIncomingWsMessage(
  rawData: string,
  handlers: {
    onContainerInterestAcknowledged: (declarationId: string) => void;
    onInterestState: (baseline: string[]) => void;
    onOrganizationInterestAcknowledged: (
      declarationId: string,
      organizationId: string | null,
      authorized: boolean,
    ) => void;
    onOrganizationReadModelChanged: (
      organizationId: string,
      originatedFromSession: boolean,
    ) => void;
    onResyncRequired: (containerId: string) => void;
    onSharedWithYou: () => void;
    onServerEvent: (event: { type: string; [key: string]: unknown }) => void;
  },
): void {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    return;
  }

  const baseline = readInterestStateContainerIds(data);
  if (baseline !== null) {
    handlers.onInterestState(baseline);
    return;
  }
  if (isServerEvent(data) && data.type === "known_containers_ack") {
    const declarationId = readContainerInterestAcknowledgement(data);
    if (declarationId !== null) {
      handlers.onContainerInterestAcknowledged(declarationId);
    }
    return;
  }
  if (isServerEvent(data) && data.type === "known_organizations_ack") {
    const organizationAcknowledgement =
      readOrganizationInterestAcknowledgement(data);
    if (organizationAcknowledgement) {
      handlers.onOrganizationInterestAcknowledged(
        organizationAcknowledgement.declarationId,
        organizationAcknowledgement.organizationId,
        organizationAcknowledgement.authorized,
      );
    }
    return;
  }
  const resyncContainerId = readResyncRequiredContainerId(data);
  if (resyncContainerId !== null) {
    handlers.onResyncRequired(resyncContainerId);
    return;
  }
  if (isSharedWithYouEvent(data)) {
    handlers.onSharedWithYou();
    return;
  }
  if (
    isServerEvent(data) &&
    (data.type === "organization_read_model_changed" ||
      data.type === "organization_read_model_access_revoked")
  ) {
    const control = readOrganizationReadModelControl(data);
    if (control) {
      handlers.onOrganizationReadModelChanged(
        control.organizationId,
        control.originatedFromSession,
      );
    }
    return;
  }
  if (isServerEvent(data)) {
    handlers.onServerEvent(data);
  }
}

let nextEventId = 0;

function useRefreshGeneration(
  subscribeRefresh: SubscribeConnectionRefreshFn | undefined,
): number {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!subscribeRefresh) {
      return;
    }
    return subscribeRefresh(() => {
      // Re-run even if connectivity stayed online. A suspended iOS socket or a
      // Wi-Fi/cellular path switch can leave readyState OPEN on a dead path.
      setGeneration((current) => current + 1);
    });
  }, [subscribeRefresh]);
  return generation;
}

function markServerEventsConnected(
  tearleads: Tearleads,
  log: (message: string) => void,
): void {
  const reconnecting = tearleads.events.connectionGeneration > 0;
  if (reconnecting) {
    // A missed access_changed may represent a revoke, move, or container key
    // epoch change. Drop cached writer projections before the HTTP sweep.
    tearleads.events.invalidateAccessState();
  }
  tearleads.events.setConnected(true);
  if (reconnecting) {
    // The declaration acknowledgement is the ordering barrier: routing is live
    // before this sweep closes the lossy interval. This also catches re-keys in
    // unopened containers, which open-document reconnect probes cannot.
    void tearleads.deviceFirst
      .open()
      .reconciler.reconcileNow()
      .catch(() => log("WebSocket: reconnect catch-up unavailable"));
  }
  log("WebSocket: interest declaration acknowledged");
  log("WebSocket connected");
}

export function useServerEventsBinding(
  tearleads: Tearleads,
  wsUrl: string,
  authToken: string | null,
  log: (message: string) => void,
  syncEnabled: boolean,
  online: boolean,
  subscribeConnectionRefresh?: SubscribeConnectionRefreshFn | undefined,
): void {
  const refreshGeneration = useRefreshGeneration(subscribeConnectionRefresh);

  useEffect(() => {
    // In local-only mode the events WebSocket stays closed: no server
    // invalidations, interest declarations, or resync signals. The reconciler
    // and upload paths pause independently via the resolved runtime
    // `state.online` (Session.syncEnabled), so both sync channels are off.
    if (!authToken || !wsUrl || !syncEnabled || !online) {
      return;
    }
    let detachOrganizationSocket: (() => void) | null = null;
    let interestHandle: ContainerInterestDeclaration | null = null;
    const stopDeclarations = (): void => {
      interestHandle?.stop();
      interestHandle = null;
      detachOrganizationSocket?.();
      detachOrganizationSocket = null;
    };
    return startServerEventsConnectionLoop({
      onDisconnect: () => {
        stopDeclarations();
        tearleads.events.setConnected(false);
      },
      onMessage: (ws, event) => {
        routeIncomingWsMessage(String(event.data), {
          onContainerInterestAcknowledged: (declarationId) => {
            if (!interestHandle?.acknowledge(declarationId)) {
              return;
            }
            markServerEventsConnected(tearleads, log);
          },
          onInterestState: (baseline) => {
            interestHandle?.stop();
            interestHandle = startContainerInterestDeclaration(
              tearleads,
              ws,
              new Set(baseline),
            );
            // Transport open and the persisted baseline are not enough: the
            // ready local tree may add containers missing from that baseline.
            // The matching acknowledgement is the ordering barrier after the
            // server has synchronously installed the authoritative current set.
            log(`WebSocket: interest baseline containers=${baseline.length}`);
          },
          onOrganizationInterestAcknowledged: (
            declarationId,
            organizationId,
            authorized,
          ) => {
            handleOrganizationReadModelInterestAcknowledgement(
              tearleads,
              ws,
              declarationId,
              organizationId,
              authorized,
            );
          },
          onOrganizationReadModelChanged: (
            organizationId,
            originatedFromSession,
          ) => {
            handleOrganizationReadModelHint(
              tearleads,
              organizationId,
              originatedFromSession,
            );
          },
          onResyncRequired: (containerId) => {
            tearleads.events.invalidateAccessState();
            const handle = interestHandle;
            handle?.invalidate(containerId);
            void resyncContainerAccess(tearleads, containerId).finally(() => {
              handle?.sync();
            });
          },
          onSharedWithYou: () => void resyncRootContainers(tearleads),
          onServerEvent: (data) => {
            tearleads.events.push({ ...data, id: String(nextEventId++) });
          },
        });
      },
      onOpen: (ws) => {
        detachOrganizationSocket?.();
        detachOrganizationSocket = attachOrganizationReadModelSocket(
          tearleads,
          ws,
        );
      },
      requestTicket: () => tearleads.requestWebSocketTicket(),
      wsUrl,
    });
  }, [
    authToken,
    log,
    online,
    refreshGeneration,
    syncEnabled,
    tearleads,
    wsUrl,
  ]);
}
