import type { Tearleads } from "@tearleads/client-sdk";
import {
  MAX_WS_INTEREST_CONTAINER_IDS,
  serializeWsClientDeclaration,
  type WsClientDeclaration,
} from "@tearleads/validators/realtime";
import { ContainerInterestAcknowledgments } from "./containerInterestAcknowledgments";

type ContainerDeclarationType = Exclude<
  WsClientDeclaration,
  { type: "known_organizations" }
>["type"];

export interface ContainerInterestDeclaration {
  readonly acknowledge: (
    declarationId: string,
    acceptedIds: readonly string[],
  ) => boolean;
  readonly stop: () => void;
  readonly sync: () => void;
  readonly invalidate: (containerId: string) => void;
  readonly retryRefused: () => void;
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

function chunkContainerIds(containerIds: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (
    let start = 0;
    start === 0 || start < containerIds.length;
    start += MAX_WS_INTEREST_CONTAINER_IDS
  ) {
    chunks.push(
      containerIds.slice(start, start + MAX_WS_INTEREST_CONTAINER_IDS),
    );
  }
  return chunks;
}

/**
 * Send one declaration as server-cap-sized frames. The server drops an
 * oversized frame unparsed and never acknowledges it, which would leave the
 * acknowledgment barrier stuck for the connection's lifetime. A split replace
 * sends its first chunk as the authoritative `known_containers` and the rest as
 * `.add`; the socket's server-side queue applies them in order. Returns the
 * declaration ids sent, or null when the socket is not open.
 */
function createInterestSender(
  ws: WebSocket,
  acknowledgments: ContainerInterestAcknowledgments,
  readTreeGeneration: () => number,
) {
  return (
    type: ContainerDeclarationType,
    containerIds: readonly string[],
  ): string[] | null => {
    if (ws.readyState !== WebSocket.OPEN) return null;
    return chunkContainerIds(containerIds).map((chunk, index) => {
      const declarationId = `container-interest-${nextDeclarationId++}`;
      acknowledgments.register(declarationId, chunk, readTreeGeneration());
      ws.send(
        serializeWsClientDeclaration({
          type:
            type === "known_containers" && index > 0
              ? "known_containers.add"
              : type,
          containerIds: chunk,
          declarationId,
        }),
      );
      return declarationId;
    });
  };
}

const INACTIVE_DECLARATION: ContainerInterestDeclaration = {
  acknowledge: () => false,
  invalidate: () => undefined,
  retryRefused: () => undefined,
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
  // Every chunk of the initial declaration must be acknowledged before the
  // connection barrier clears; the authoritative set is not installed until
  // the last one lands.
  let initialDeclarationIds = new Set<string>();
  let stopped = false;
  let syncRequested = false;

  const send = createInterestSender(ws, acknowledgments, () => treeGeneration);

  const syncInterest = (): void => {
    if (stopped) return;
    // Wait for the current round, then diff the latest tree once. A bulk crawl
    // can emit hundreds of snapshots while signed authorization is pending.
    if (acknowledgments.hasPending) {
      syncRequested = true;
      return;
    }
    syncRequested = false;
    const snapshot = store.getSnapshot();
    if (!snapshot.ready) {
      // A cold tree starts as ready=false/nodes=[]. Removing the hydrated
      // baseline against that placeholder would reopen the event-loss window.
      return;
    }
    const current = new Set(snapshot.nodes.map((node) => node.id));
    if (!initialAcknowledged) {
      const declarationIds = send("known_containers", [...current]);
      if (declarationIds) {
        declared = current;
        initialDeclarationIds = new Set(declarationIds);
      }
      return;
    }

    const { added, removed } = diffInterest(current, declared);
    if (added.length > 0) send("known_containers.add", added);
    if (removed.length > 0) send("known_containers.remove", removed);
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
        !initialAcknowledged &&
        initialDeclarationIds.delete(declarationId) &&
        initialDeclarationIds.size === 0;
      if (initial) {
        initialAcknowledged = true;
      }
      // A tree change may have made a refused ID available while its request
      // was pending. Retry once for that change, never just because of denial.
      if (result.retry || syncRequested) syncInterest();
      return initial;
    },
    retryRefused: () => {
      if (stopped) return;
      // Keep accepted and pending IDs declared. A pending refusal observes
      // this generation and retries after its acknowledgment, preserving the
      // initial connection barrier instead of sending another full replace.
      treeGeneration++;
      if (initialAcknowledged) syncInterest();
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
