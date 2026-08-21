import type { DocumentSummary } from "../../data/documents/documentSummary";
import type { ContainerContentsStoreRuntime } from "../container-contents/syncAgent";
import type { ContainerNode } from "../container-contents/types";

/**
 * Device-first, synchronously-readable view of one domain scope.
 *
 * `ready` is a pure function of *local* hydration (SQLite/OPFS load). It is
 * never gated on authentication, network, or remote reconciliation — that is
 * the core invariant that keeps Explorer's first paint instant after register.
 */
export interface LocalProjectionSnapshot {
  /** True once the local container tree + summaries have loaded from SQLite. */
  ready: boolean;
  /** Container tree nodes, sorted, as produced by the container-contents store. */
  containers: ReadonlyArray<ContainerNode>;
  /** Document summaries grouped by the container they were discovered under. */
  documentSummariesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >;
  /** Container links per document id (reverse index used by the explorer UI). */
  linkedContainerIdsByDocumentId: ReadonlyMap<string, ReadonlyArray<string>>;
}

/**
 * A patch applied by the background reconciler (Layer B) into the local
 * projection (Layer A). Summaries replace the prior set for each listed
 * container; links replace the prior set for each listed document.
 */
export interface LocalProjectionReconciledDelta {
  containerId: string;
  documentSummaries: ReadonlyArray<DocumentSummary>;
  linkedContainerIdsByDocumentId?:
    | ReadonlyMap<string, ReadonlyArray<string>>
    | undefined;
}

/** Read side of the app-facing `symcrypt.deviceFirst.open()` handle. */
export interface LocalProjectionView {
  getSnapshot: () => LocalProjectionSnapshot;
  subscribe: (listener: () => void) => () => void;
  /**
   * Report which container the user is viewing so the reconciler can sync it
   * first. Passing `null` clears the active pointer.
   */
  setActiveContainer: (containerId: string | null) => void;
  /**
   * Push the latest workflow runtime into the view. Call this from an effect
   * (never during render): it may emit synchronously to subscribers.
   */
  updateRuntime: (runtime: ContainerContentsStoreRuntime) => void;
}
