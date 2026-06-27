import type { Tearleads } from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import { hasStringProperty } from "@tearleads/validators/util";
import { useEffect } from "react";

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

// Force a fresh access check + tree re-list for a container the server flagged.
// HTTP is the source of access truth: a now-unauthorized container drops out of
// the tree (and interest); a still-authorized one is re-validated.
async function resyncContainerAccess(
  tearleads: Tearleads,
  containerId: string,
): Promise<void> {
  const resyncTasks: Promise<unknown>[] = [];
  try {
    // Re-validate just the affected container (force re-discovery), not the
    // whole tree; a single access change should not re-sync everything.
    tearleads.deviceFirst
      .reconciler()
      .enqueueContainer(containerId, "active", true);
  } catch {
    // Reconciler unavailable (runtime not ready); the refresh below still runs.
  }
  try {
    resyncTasks.push(tearleads.containerContents.openTree().refresh());
  } catch {
    // Runtime not ready; the next reconnect re-validates from a ready tree.
  }
  await Promise.allSettled(resyncTasks);
}

function routeIncomingWsMessage(
  rawData: string,
  handlers: {
    onInterestState: (baseline: string[]) => void;
    onResyncRequired: (containerId: string) => void;
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
  const resyncContainerId = readResyncRequiredContainerId(data);
  if (resyncContainerId !== null) {
    handlers.onResyncRequired(resyncContainerId);
    return;
  }
  if (isServerEvent(data)) {
    handlers.onServerEvent(data);
  }
}

function appendTicketToWsUrl(wsUrl: string, ticket: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

// Single pass over each set so only the changed ids are allocated, not a full
// array copy of a possibly-thousands-strong known set on every change.
function diffContainerInterest(
  current: ReadonlySet<string>,
  declared: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  for (const id of current) {
    if (!declared.has(id)) {
      added.push(id);
    }
  }
  const removed: string[] = [];
  for (const id of declared) {
    if (!current.has(id)) {
      removed.push(id);
    }
  }
  return { added, removed };
}

/**
 * Declare the containers this client cares about so the server only routes their
 * invalidations here. Seeds from the (passively shared) container tree and pushes
 * add/remove deltas as it changes, rather than re-sending the whole set. Interest
 * is not authorization; the server still enforces access, and missed events are
 * recovered over HTTP sync.
 */
interface ContainerInterestDeclaration {
  readonly stop: () => void;
  readonly sync: () => void;
  readonly invalidate: (containerId: string) => void;
}

export function startContainerInterestDeclaration(
  tearleads: Tearleads,
  ws: WebSocket,
  baseline: ReadonlySet<string>,
): ContainerInterestDeclaration {
  let store: ReturnType<Tearleads["containerContents"]["openTree"]>;
  try {
    store = tearleads.containerContents.openTree();
  } catch {
    return {
      invalidate: () => undefined,
      stop: () => undefined,
      sync: () => undefined,
    };
  }

  let declared = new Set(baseline);
  let stopped = false;

  const send = (message: Record<string, unknown>): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const syncInterest = (): void => {
    if (stopped) {
      return;
    }
    const current = new Set(store.getSnapshot().nodes.map((node) => node.id));
    const { added, removed } = diffContainerInterest(current, declared);
    if (added.length > 0) {
      send({ type: "known_containers.add", containerIds: added });
    }
    if (removed.length > 0) {
      send({ type: "known_containers.remove", containerIds: removed });
    }
    declared = current;
  };

  syncInterest();
  const unsubscribe = store.subscribe(syncInterest);
  return {
    invalidate: (containerId: string) => {
      declared.delete(containerId);
    },
    stop: () => {
      stopped = true;
      unsubscribe();
    },
    sync: syncInterest,
  };
}

let nextEventId = 0;

export function useServerEventsBinding(
  tearleads: Tearleads,
  wsUrl: string,
  authToken: string | null,
  log: (message: string) => void,
): void {
  useEffect(() => {
    if (!authToken || !wsUrl) {
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let interestHandle: ContainerInterestDeclaration | null = null;

    void (async () => {
      const ticket = await tearleads.requestWebSocketTicket();
      if (cancelled || ticket === null) {
        return;
      }

      const ws = new WebSocket(appendTicketToWsUrl(wsUrl, ticket));
      socket = ws;

      ws.addEventListener("open", () => {
        if (!cancelled) {
          tearleads.events.setConnected(true);
          log("WebSocket connected");
        }
      });

      ws.addEventListener("message", (event) => {
        if (cancelled) {
          return;
        }

        routeIncomingWsMessage(String(event.data), {
          onInterestState: (baseline) => {
            interestHandle?.stop();
            interestHandle = startContainerInterestDeclaration(
              tearleads,
              ws,
              new Set(baseline),
            );
          },
          onResyncRequired: (containerId) => {
            const handle = interestHandle;
            handle?.invalidate(containerId);
            void resyncContainerAccess(tearleads, containerId).finally(() => {
              handle?.sync();
            });
          },
          onServerEvent: (data) => {
            tearleads.events.push({ ...data, id: String(nextEventId++) });
          },
        });
      });

      ws.addEventListener("close", () => {
        interestHandle?.stop();
        interestHandle = null;
        if (!cancelled) {
          tearleads.events.setConnected(false);
        }
      });

      ws.addEventListener("error", () => {
        interestHandle?.stop();
        interestHandle = null;
        if (!cancelled) {
          tearleads.events.setConnected(false);
        }
      });
    })();

    return () => {
      cancelled = true;
      interestHandle?.stop();
      socket?.close();
      tearleads.events.setConnected(false);
    };
  }, [authToken, log, tearleads, wsUrl]);
}
