import type { Tearleads } from "@tearleads/client-sdk";
import {
  serializeWsClientDeclaration,
  type WsClientDeclaration,
} from "@tearleads/validators/realtime";
import { ContainerInterestAcknowledgments } from "./containerInterestAcknowledgments";

export interface ContainerInterestDeclaration {
  readonly acknowledge: (
    declarationId: string,
    acceptedIds: readonly string[],
  ) => boolean;
  readonly stop: () => void;
  readonly sync: () => void;
  readonly invalidate: (containerId: string) => void;
  readonly invalidateAll: () => void;
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

function createInterestSender(
  ws: WebSocket,
  acknowledgments: ContainerInterestAcknowledgments,
  readTreeGeneration: () => number,
) {
  return (
    declaration: Exclude<WsClientDeclaration, { type: "known_organizations" }>,
  ): boolean => {
    if (ws.readyState !== WebSocket.OPEN) return false;
    if (declaration.declarationId)
      acknowledgments.register(
        declaration.declarationId,
        declaration.containerIds ?? [],
        readTreeGeneration(),
      );
    ws.send(serializeWsClientDeclaration(declaration));
    return true;
  };
}

const INACTIVE_DECLARATION: ContainerInterestDeclaration = {
  acknowledge: () => false,
  invalidate: () => undefined,
  invalidateAll: () => undefined,
  stop: () => undefined,
  sync: () => undefined,
};

function resolveContainerInterestStore(tearleads: Tearleads) {
  try {
    return tearleads.deviceFirst.open().containerStore;
  } catch {
    return null;
  }
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
  const store = resolveContainerInterestStore(tearleads);
  if (!store) return INACTIVE_DECLARATION;

  let declared = new Set(baseline);
  const acknowledgments = new ContainerInterestAcknowledgments();
  let treeGeneration = 0;
  let initialAcknowledged = false;
  let initialDeclarationId: string | null = null;
  let stopped = false;

  const send = createInterestSender(ws, acknowledgments, () => treeGeneration);

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
      send({
        type: "known_containers.add",
        containerIds: added,
        declarationId: `container-interest-${nextDeclarationId++}`,
      });
    }
    if (removed.length > 0) {
      send({
        type: "known_containers.remove",
        containerIds: removed,
        declarationId: `container-interest-${nextDeclarationId++}`,
      });
    }
    declared = current;
  };

  syncInterest();
  const unsubscribe = store.subscribe(() => {
    treeGeneration++;
    syncInterest();
  });
  return {
    acknowledge: (declarationId, acceptedIds) => {
      if (stopped) return false;
      const result = acknowledgments.apply(
        declarationId,
        acceptedIds,
        declared,
        treeGeneration,
      );
      if (!result.processed) return false;
      const initial =
        !initialAcknowledged && declarationId === initialDeclarationId;
      if (initial) {
        initialAcknowledged = true;
        initialDeclarationId = null;
      }
      // A tree change may have made a refused ID available while its request
      // was pending. Retry once for that change, never just because of denial.
      if (result.retry) syncInterest();
      return initial;
    },
    invalidateAll: () => {
      declared.clear();
      acknowledgments.invalidate();
    },
    invalidate: (containerId) => {
      declared.delete(containerId);
      acknowledgments.invalidate(containerId);
    },
    stop: () => {
      stopped = true;
      acknowledgments.stop();
      unsubscribe();
    },
    sync: syncInterest,
  };
}
