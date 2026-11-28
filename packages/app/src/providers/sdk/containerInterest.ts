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
  /**
   * The initial acknowledgement is outstanding: the declaration is sent, or
   * waits for the local tree to load before it sends.
   */
  readonly awaitingInitialAcknowledgement: () => boolean;
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

/**
 * Select the subtree roots this client declares to the realtime hub: top-level
 * roots, directly granted nested folders (`rootLaneMember`), and any node whose
 * parent is absent from the local snapshot. Ordinary descendants under a held
 * parent are covered by their root's subscription on the hub.
 */
function selectDeclaredRootIds(
  nodes: ReadonlyArray<{
    readonly id: string;
    readonly parentId?: string | null | undefined;
    readonly rootLaneMember?: boolean | undefined;
  }>,
): Set<string> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const roots = new Set<string>();
  for (const node of nodes) {
    if (
      node.parentId === null ||
      node.parentId === undefined ||
      node.rootLaneMember === true ||
      !nodeIds.has(node.parentId)
    ) {
      roots.add(node.id);
      if (roots.size >= MAX_WS_INTEREST_CONTAINER_IDS) break;
    }
  }
  return roots;
}

const INACTIVE_DECLARATION: ContainerInterestDeclaration = {
  acknowledge: () => false,
  awaitingInitialAcknowledgement: () => false,
  invalidate: () => undefined,
  retryRefused: () => undefined,
  stop: () => undefined,
  sync: () => undefined,
};

export interface ContainerInterestDeclarationOptions {
  /** Called once the first `known_containers` frame is written to the socket. */
  readonly onDeclared?: () => void;
  /** Called if `deviceFirst.open()` fails when opening the container store. */
  readonly onUnavailable?: () => void;
}

function resolveContainerInterestStore(tearleads: Tearleads) {
  try {
    return tearleads.deviceFirst.open().containerStore;
  } catch (error) {
    try {
      tearleads.logError?.(
        "Failed to open container interest store for server events",
        error,
      );
    } catch {
      // Keep logger failures from masking container-interest unavailability.
    }
    return null;
  }
}

type InterestTree = NonNullable<
  ReturnType<typeof resolveContainerInterestStore>
>;

export function startContainerInterestDeclaration(
  sdk: Tearleads,
  ws: WebSocket,
  options?: ContainerInterestDeclarationOptions,
): ContainerInterestDeclaration {
  const tree = resolveContainerInterestStore(sdk);
  if (!tree) {
    options?.onUnavailable?.();
    return INACTIVE_DECLARATION;
  }
  return declareInterest(ws, tree, options);
}

function sendContainerDeclaration(
  ws: WebSocket,
  acknowledgments: ContainerInterestAcknowledgments,
  treeGeneration: number,
  type: ContainerDeclarationType,
  containerIds: readonly string[],
): string | null {
  if (ws.readyState !== WebSocket.OPEN) return null;
  const bounded = containerIds.slice(0, MAX_WS_INTEREST_CONTAINER_IDS);
  const declarationId = `container-interest-${nextDeclarationId++}`;
  acknowledgments.register(declarationId, bounded, treeGeneration);
  ws.send(
    serializeWsClientDeclaration({
      type,
      containerIds: bounded,
      declarationId,
    }),
  );
  return declarationId;
}

function declareInterest(
  ws: WebSocket,
  tree: Pick<InterestTree, "getSnapshot" | "subscribe">,
  options?: ContainerInterestDeclarationOptions,
): ContainerInterestDeclaration {
  let declared = new Set<string>();
  const acknowledgments = new ContainerInterestAcknowledgments();
  let treeGeneration = 0;
  let initialAcknowledged = false;
  let initialDeclarationId: string | null = null;
  let stopped = false;
  let syncRequested = false;

  const send = (
    type: ContainerDeclarationType,
    containerIds: readonly string[],
  ): string | null =>
    sendContainerDeclaration(
      ws,
      acknowledgments,
      treeGeneration,
      type,
      containerIds,
    );

  const syncInterest = (): void => {
    if (stopped) return;
    // Wait for the current round, then diff the latest tree once. A bulk crawl
    // can emit hundreds of snapshots while signed authorization is pending.
    if (acknowledgments.hasPending) {
      syncRequested = true;
      return;
    }
    syncRequested = false;
    const snapshot = tree.getSnapshot();
    if (!snapshot.ready) {
      // A cold tree starts as ready=false/nodes=[]. Declaring that placeholder
      // would clear the reconnect barrier before the real tree is covered.
      return;
    }
    const current = selectDeclaredRootIds(snapshot.nodes);
    if (!initialAcknowledged) {
      const declarationId = send("known_containers", [...current]);
      if (declarationId) {
        declared = current;
        initialDeclarationId = declarationId;
        options?.onDeclared?.();
      }
      return;
    }

    const { added, removed } = diffInterest(current, declared);
    if (added.length > 0) send("known_containers.add", added);
    if (removed.length > 0) send("known_containers.remove", removed);
    declared = current;
  };

  syncInterest();
  const unsubscribe = tree.subscribe(() => {
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
      }
      // A tree change may have made a refused ID available while its request
      // was pending. Retry once for that change, never just because of denial.
      if (result.retry || syncRequested) syncInterest();
      return initial;
    },
    awaitingInitialAcknowledgement: () => !stopped && !initialAcknowledged,
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
