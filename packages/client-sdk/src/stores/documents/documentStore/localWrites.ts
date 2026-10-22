import type { DocumentSnapshot, DocumentStore } from "../types";

interface LocalWriteState {
  pendingLocalWrites: number;
  snapshot: DocumentSnapshot;
  writeChain: Promise<void>;
}

const writeChainIdleByState = new WeakMap<LocalWriteState, () => boolean>();

/**
 * Records whether the latest work appended to `writeChain` has settled. Text,
 * field, row, attachment, and rotation writes all extend that one chain, so
 * this is true only when no local mutation of any kind is still queued.
 */
export function trackWriteChain<State extends LocalWriteState>(
  state: State,
): State {
  let current = state.writeChain;
  let idle = true;
  Object.defineProperty(state, "writeChain", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (next: Promise<void>) => {
      current = next;
      idle = false;
      const settle = () => {
        if (current === next) idle = true;
      };
      next.then(settle, settle);
    },
  });
  writeChainIdleByState.set(state, () => idle);
  return state;
}

/** The store members that only read its state. */
export function readBackingDocumentStore(
  state: LocalWriteState,
): Pick<DocumentStore, "getSnapshot" | "hasPendingLocalWrites"> {
  return {
    getSnapshot: () => state.snapshot,
    hasPendingLocalWrites: () =>
      state.pendingLocalWrites > 0 ||
      !(writeChainIdleByState.get(state)?.() ?? true),
  };
}
