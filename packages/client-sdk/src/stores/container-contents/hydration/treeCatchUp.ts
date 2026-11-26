import type { DomainScope } from "../../../data/shared/domainScope";
import type { ExecSql } from "../../../workflows/container-contents/containerPersistence";
import { requestDocumentLaneListings } from "../../../workflows/container-contents/documentDiscovery/documentLaneDiscovery";
import {
  NO_TREE_CATCH_UP,
  type TreeCatchUpEvent,
  type TreeCatchUpState,
  transitionTreeCatchUp,
} from "./treeCatchUpMachine";

/**
 * What a scope's tree crawl tells whoever lists its document lanes. The
 * container store reports; the reconciler asks and listens. One per domain
 * scope; see `getOrCreateTreeCatchUp`.
 */
export interface TreeCatchUp {
  /** An acknowledged connection owes a crawl of the tree. */
  crawlOwed(): void;
  /**
   * That crawl settled. `complete` when it listed every lane it queued, so
   * a document lane whose container's row it was not served did not move.
   */
  crawlSettled(complete: boolean): void;
  /**
   * Whether the crawl the last acknowledged connection owes completed. Waits
   * while it is owed; false with no acknowledged crawl to vouch for anything.
   */
  whenCrawlSettles(): Promise<boolean>;
  /**
   * A tree listing owed document lanes a listing; the requests are durable
   * already. Listeners are told once for a burst of calls.
   */
  lanesOwed(): void;
  /** Told after document lanes were owed a listing. */
  subscribeToOwedLanes(listener: () => void): () => void;
}

function createTreeCatchUp(): TreeCatchUp {
  let state: TreeCatchUpState = NO_TREE_CATCH_UP;
  let waiters: Array<(complete: boolean) => void> = [];
  let owedLanesNotice = false;
  const listeners = new Set<() => void>();
  const dispatch = (event: TreeCatchUpEvent) => {
    state = transitionTreeCatchUp(state, event);
    if (state.status === "owed") return;
    const complete = state.status === "complete";
    const settled = waiters;
    waiters = [];
    for (const resolve of settled) resolve(complete);
  };
  return {
    crawlOwed: () => dispatch({ type: "owed" }),
    crawlSettled: (complete) => dispatch({ complete, type: "settled" }),
    whenCrawlSettles: () =>
      state.status === "owed"
        ? new Promise((resolve) => {
            waiters.push(resolve);
          })
        : Promise.resolve(state.status === "complete"),
    lanesOwed: () => {
      if (owedLanesNotice) return;
      owedLanesNotice = true;
      queueMicrotask(() => {
        owedLanesNotice = false;
        for (const listener of [...listeners]) listener();
      });
    },
    subscribeToOwedLanes: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const treeCatchUpByScope = new WeakMap<DomainScope, TreeCatchUp>();

/** The scope's tree catch-up port, created on first use. */
export function getOrCreateTreeCatchUp(domainScope: DomainScope): TreeCatchUp {
  const existing = treeCatchUpByScope.get(domainScope);
  if (existing) return existing;
  const created = createTreeCatchUp();
  treeCatchUpByScope.set(domainScope, created);
  return created;
}

/**
 * Owes each container's document lane one listing, durably, then announces
 * it. The container store's tree listing calls it for the rows it is served,
 * before it applies them or saves the lane's watermark past them.
 */
export async function oweDocumentLaneListings(
  state: {
    readonly runtime: {
      readonly infra: { readonly execSql: ExecSql };
      readonly state: { readonly domainScope: DomainScope };
    };
  },
  containerIds: ReadonlyArray<string>,
): Promise<void> {
  if (containerIds.length === 0) return;
  await requestDocumentLaneListings(state.runtime.infra.execSql, containerIds);
  getOrCreateTreeCatchUp(state.runtime.state.domainScope).lanesOwed();
}
