import type { Tearleads } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";

interface PendingBackupStore {
  readonly snapshot: ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
  update(change: (fingerprints: Set<string>) => void): void;
}

function createPendingBackupStore(): PendingBackupStore {
  let snapshot: ReadonlySet<string> = new Set();
  const listeners = new Set<() => void>();
  return {
    get snapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(change) {
      const next = new Set(snapshot);
      change(next);
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Identities Identity Manager created whose recovery key the user has not yet
 * agreed is backed up, per SDK instance. Identity Manager remounts as the
 * active identity changes and may be closed, so the window cannot hold this
 * itself. Memory only: a reload forgets it, as onboarding forgets its prompt.
 */
const pendingByRuntime = new WeakMap<Tearleads, PendingBackupStore>();

function getOrCreatePendingBackupStore(sdk: Tearleads): PendingBackupStore {
  let store = pendingByRuntime.get(sdk);
  if (!store) {
    store = createPendingBackupStore();
    pendingByRuntime.set(sdk, store);
  }
  return store;
}

/**
 * Holds an identity Identity Manager just created until the user confirms its
 * recovery key is backed up. The prompt belongs to that identity, so it shows
 * only while that identity is the active one.
 */
export function useNewIdentityBackupPrompt(activeFingerprint: string | null) {
  const tearleads = useTearleads();
  const store = getOrCreatePendingBackupStore(tearleads);
  const fingerprints = useTearleadsStoreSnapshot(store);
  /** Call once a creation resolves, while its identity is the active one. */
  const identityCreated = useCallback(() => {
    const created = tearleads.identity.signingFingerprint;
    if (created) store.update((pending) => pending.add(created));
  }, [store, tearleads]);
  const confirm = useCallback(() => {
    if (activeFingerprint) {
      store.update((pending) => pending.delete(activeFingerprint));
    }
  }, [activeFingerprint, store]);
  return {
    confirm,
    identityCreated,
    pending: activeFingerprint !== null && fingerprints.has(activeFingerprint),
  };
}
