import {
  getOrCreateDomainSyncCoordinator,
  type Tearleads,
} from "@tearleads/client-sdk";

import { useEffect, useState } from "react";
import type { SubscribeConnectionRefreshFn } from "../../host/AppHostConfig";
import { trackConnectAttempts } from "./connectAttemptTracker";
import {
  type ContainerInterestDeclaration,
  startContainerInterestDeclaration as declareInterest,
} from "./containerInterest";
import {
  attachOrganizationReadModelSocket,
  handleOrganizationReadModelAccessRevoked,
  handleOrganizationReadModelHint,
  handleOrganizationReadModelInterestAcknowledgement,
} from "./organizationReadModelRealtime";
import { startServerEventsConnectionLoop } from "./serverEventsConnectionLoop";
import { routeIncomingWsMessage } from "./serverEventsRouting";

export function startContainerInterestDeclaration(
  tearleads: Tearleads,
  ws: WebSocket,
) {
  const scope = tearleads.domainScope;
  const coordinator = getOrCreateDomainSyncCoordinator(scope);
  const handle = declareInterest(tearleads, ws);
  // A socket owns its declaration queue and its acknowledged tree. Retiring
  // them together lets the existing reconnect loop establish a fresh barrier.
  const retire = () => {
    if (!coordinator.isDisposed()) return;
    handle.stop();
    if (tearleads.domainScope === scope) tearleads.events.setConnected(false);
    ws.close();
  };
  const detach = coordinator.subscribe(retire);
  retire();
  return {
    ...handle,
    stop: () => {
      detach();
      handle.stop();
    },
  };
}

// Revalidate affected contents, then re-list the root lane plus each flagged
// container's parent lane and own child lane once.
export async function resyncContainerAccess(
  tearleads: Tearleads,
  containerIds: readonly string[],
): Promise<void> {
  const flagged = new Set(containerIds);
  // Notify open SDK stores before re-listing: eviction removed the child from
  // interest, so a subsequent parent hint cannot identify its stale projection.
  tearleads.events.push({
    id: crypto.randomUUID(),
    type: "resync_required",
    containerIds: [...flagged],
  });
  for (const containerId of flagged) {
    try {
      tearleads.deviceFirst
        .open()
        .reconciler.enqueueContainer(containerId, "active", true);
    } catch {
      // Runtime not ready; reconnect will revalidate the ready tree.
    }
  }
  try {
    const tree = tearleads.deviceFirst.open().containerStore;
    const known = tree
      .getSnapshot()
      .nodes.filter((node) => flagged.has(node.id));
    // Nested tombstones are returned by their parent lane, and a child created
    // while this client missed its hint (a reconnect resync) is returned only
    // by the flagged container's own lane. Batch both with one root refresh
    // instead of repeating that refresh for every container.
    const parentIds = [
      ...new Set([
        ...known.flatMap((node) =>
          node.parentId !== null ? [node.parentId] : [],
        ),
        ...known.map((node) => node.id),
      ]),
    ];
    await tree.refreshRootLane(parentIds.length ? { parentIds } : undefined);
  } catch {
    // Runtime not ready; the next reconnect revalidates from a ready tree.
  }
}

// Tracks an in-flight root re-list per sign-in so shared-container hints coalesce into a
// single sweep plus at most one trailing sweep, instead of firing concurrently.
const activeRootResyncBySignIn = new WeakMap<
  () => boolean,
  { readonly promise: Promise<void>; pending: boolean }
>();

// Re-list the user's root containers so a newly shared container appears without
// a manual refresh. The share has no node in the local tree to target yet, so
// this drives the root lane (the same sweep Explorer runs on open) rather than
// resyncContainerAccess's single-container path.
//
// The reconciler single-flights concurrent sweeps, so this never issues
// redundant parallel re-lists. A fresh-listing request never joins a sweep that
// was already running when the event arrived (an explorer catch-up, say), whose
// root list may predate the share; it queues behind it instead. The coalescing
// here additionally schedules one trailing sweep when events land while this
// sweep is in flight, so a share whose grant commits after the active sweep
// already fetched the root list is still picked up rather than waiting for the
// next event or manual refresh.
async function resyncRootContainers(
  tearleads: Tearleads,
  current = tearleads.session.captureSignIn(),
): Promise<void> {
  if (!current()) return;
  const active = activeRootResyncBySignIn.get(current);
  if (active) {
    active.pending = true;
    return active.promise;
  }

  const runSweep = async (): Promise<void> => {
    try {
      await tearleads.deviceFirst
        .open()
        .reconciler.reconcileRootContainersNow({ freshListing: true });
    } catch {
      // Runtime not ready; the next reconnect or manual refresh re-lists roots.
    }
  };

  const state = { pending: false, promise: runSweep() };
  activeRootResyncBySignIn.set(current, state);
  await state.promise;
  activeRootResyncBySignIn.delete(current);

  if (state.pending) {
    await resyncRootContainers(tearleads, current);
  }
}

function resyncDeclaredContainer(
  tearleads: Tearleads,
  handle: ContainerInterestDeclaration | null,
  containerIds: readonly string[],
): void {
  tearleads.events.invalidateAccessState();
  for (const containerId of containerIds) handle?.invalidate(containerId);
  void resyncContainerAccess(tearleads, containerIds).finally(() =>
    handle?.sync(),
  );
}

function resyncSharedContainerInterest(
  tearleads: Tearleads,
  handle: ContainerInterestDeclaration | null,
): void {
  tearleads.events.invalidateAccessState();
  void resyncRootContainers(tearleads).finally(() => handle?.retryRefused());
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

// Applies the user's per-organization sync choices, including any made on
// another device while this one was disconnected.
function refreshOrganizationMemberships(
  tearleads: Tearleads,
  log: (message: string) => void,
): void {
  void tearleads.organizations.memberships
    .refresh()
    .catch(() => log("WebSocket: organization memberships unavailable"));
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
  // The declaration acknowledgement is the ordering barrier: routing is live
  // before the SDK closes the lossy interval. Advancing the connection
  // generation here is what starts that catch-up, on a first connection as on
  // a reconnect: the container store re-lists the tree, and the reconciler
  // lists each document lane that moved and owes a read to each document
  // that moved in it.
  tearleads.events.setConnected(true);
  refreshOrganizationMemberships(tearleads, log);
  log("WebSocket: interest declaration acknowledged");
  log("WebSocket connected");
}

function routeSocketMessage(
  tearleads: Tearleads,
  ws: WebSocket,
  event: MessageEvent,
  interestHandle: ContainerInterestDeclaration | null,
  log: (message: string) => void,
) {
  routeIncomingWsMessage(String(event.data), {
    onContainerInterestAcknowledged: (declarationId, containerIds) => {
      if (!interestHandle?.acknowledge(declarationId, containerIds)) {
        return;
      }
      markServerEventsConnected(tearleads, log);
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
    onOrganizationReadModelChanged: (organizationId, cursor) => {
      handleOrganizationReadModelHint(tearleads, organizationId, cursor);
    },
    onOrganizationReadModelAccessRevoked: (organizationId) => {
      handleOrganizationReadModelAccessRevoked(tearleads, organizationId);
    },
    onOrganizationMembershipsChanged: () =>
      refreshOrganizationMemberships(tearleads, log),
    onResyncRequired: (containerIds) =>
      resyncDeclaredContainer(tearleads, interestHandle, containerIds),
    onSharedWithYou: () => {
      resyncSharedContainerInterest(tearleads, interestHandle);
      // Joining (or rejoining) an organization arrives as a share; a
      // rejoin starts with the member's earlier choices cleared.
      refreshOrganizationMemberships(tearleads, log);
    },
    onServerEvent: (data) => {
      tearleads.events.push({ ...data, id: String(nextEventId++) });
    },
  });
}

function stopWithSession(
  session: Tearleads["session"],
  current: () => boolean,
  stop: () => void,
) {
  // A same-bearer replacement can deliver a frame before React cleanup.
  const retire = () => {
    if (!current()) stop();
  };
  const unsubscribe = session.subscribe(retire);
  retire();
  return () => {
    unsubscribe();
    stop();
  };
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
  const signInCurrent = tearleads.session.captureSignIn();

  useEffect(() => {
    // In local-only mode the events WebSocket stays closed: no server
    // invalidations, interest declarations, or resync signals. The reconciler
    // and upload paths pause independently via the resolved runtime
    // `state.online` (Session.syncEnabled), so both sync channels are off.
    if (!signInCurrent() || !authToken || !wsUrl || !syncEnabled || !online) {
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
    const attempts = trackConnectAttempts(tearleads.events);
    const stopLoop = startServerEventsConnectionLoop({
      onAttemptStart: attempts.begin,
      onAttemptFailed: attempts.end,
      onDisconnect: () => {
        stopDeclarations();
        tearleads.events.setConnected(false);
      },
      onMessage: (ws, event) => {
        if (!signInCurrent()) return;
        routeSocketMessage(tearleads, ws, event, interestHandle, log);
      },
      onOpen: (ws) => {
        // A socket opens with no container interest and routes no container
        // hint until this declaration is installed. Transport open is not the
        // ordering barrier: the matching acknowledgement is, after the server
        // has synchronously installed the authoritative current set.
        interestHandle?.stop();
        interestHandle = startContainerInterestDeclaration(tearleads, ws);
        // An unready tree holds the declaration unboundedly: stop deferring.
        if (interestHandle.awaitingInitialAcknowledgement()) {
          attempts.awaitAcknowledgement();
        } else attempts.end();
        detachOrganizationSocket?.();
        detachOrganizationSocket = attachOrganizationReadModelSocket(
          tearleads,
          ws,
        );
      },
      openSocket: (ticket) => tearleads.openServerEventsSocket(wsUrl, ticket),
      requestTicket: () => tearleads.requestWebSocketTicket(),
    });
    return stopWithSession(
      tearleads.session,
      signInCurrent,
      attempts.endingWith(stopLoop),
    );
  }, [
    authToken,
    log,
    online,
    refreshGeneration,
    signInCurrent,
    syncEnabled,
    tearleads,
    wsUrl,
  ]);
}
