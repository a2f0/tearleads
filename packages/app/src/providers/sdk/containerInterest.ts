import type { Tearleads } from "@tearleads/client-sdk";
import {
  serializeWsClientDeclaration,
  type WsClientDeclaration,
} from "@tearleads/validators/realtime";

export interface ContainerInterestDeclaration {
  readonly acknowledge: (declarationId: string) => boolean;
  readonly stop: () => void;
  readonly sync: () => void;
  readonly invalidate: (containerId: string) => void;
}

let nextDeclarationId = 0;

function diffInterest(
  current: ReadonlySet<string>,
  declared: ReadonlySet<string>,
): { added: string[]; removed: string[] } {
  const added: string[] = [];
  for (const id of current) {
    if (!declared.has(id)) added.push(id);
  }
  const removed: string[] = [];
  for (const id of declared) {
    if (!current.has(id)) removed.push(id);
  }
  return { added, removed };
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

/**
 * Retain the restored server baseline until the local tree is ready, send one
 * acknowledged authoritative declaration, then push add/remove deltas.
 * Interest is routing state, not an authorization grant.
 */
export function startContainerInterestDeclaration(
  tearleads: Tearleads,
  ws: WebSocket,
  baseline: ReadonlySet<string>,
): ContainerInterestDeclaration {
  let store: ReturnType<Tearleads["deviceFirst"]["open"]>["containerStore"];
  try {
    store = tearleads.deviceFirst.open().containerStore;
  } catch {
    return {
      acknowledge: () => false,
      invalidate: () => undefined,
      stop: () => undefined,
      sync: () => undefined,
    };
  }

  let declared = new Set(baseline);
  let initialAcknowledged = false;
  let initialDeclarationId: string | null = null;
  let stopped = false;

  const send = (declaration: WsClientDeclaration): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    ws.send(serializeWsClientDeclaration(declaration));
    return true;
  };

  const syncInterest = (): void => {
    if (stopped) return;
    const snapshot = store.getSnapshot();
    if (!snapshot.ready) {
      // A cold tree starts as ready=false/nodes=[]. Removing the hydrated
      // baseline against that placeholder would reopen the event-loss window.
      return;
    }
    const current = new Set(snapshot.nodes.map((node) => node.id));
    if (!initialAcknowledged) {
      if (initialDeclarationId !== null && setsEqual(current, declared)) return;
      const declarationId = `container-interest-${nextDeclarationId++}`;
      if (
        send({
          type: "known_containers",
          containerIds: [...current],
          declarationId,
        })
      ) {
        declared = current;
        initialDeclarationId = declarationId;
      }
      return;
    }

    const { added, removed } = diffInterest(current, declared);
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
    acknowledge: (declarationId) => {
      if (
        stopped ||
        initialAcknowledged ||
        declarationId !== initialDeclarationId
      ) {
        return false;
      }
      initialAcknowledged = true;
      initialDeclarationId = null;
      return true;
    },
    invalidate: (containerId) => {
      declared.delete(containerId);
    },
    stop: () => {
      stopped = true;
      unsubscribe();
    },
    sync: syncInterest,
  };
}
