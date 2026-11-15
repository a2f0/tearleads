import { defaultDocumentsPersistence } from "@tearleads/client-sdk";
import {
  type addressSurfaces,
  createAddressRetryHarness,
} from "./contactAddressRetryHarness";

type Mutation = "add" | "update" | "remove" | "flush";

async function reachedBeforeSettlement(
  entered: Promise<void>,
  operation: Promise<unknown>,
) {
  await Promise.race([
    entered,
    operation.then(() => {
      throw new Error("Operation settled before the queue barrier");
    }),
  ]);
}

export async function createQueuedAuthorityHarness(
  surface: (typeof addressSurfaces)[number],
) {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const queued = Promise.withResolvers<void>();
  const owned: Promise<unknown>[] = [];
  let watched: Mutation | undefined;
  let hold = false;
  function observe<T>(mutation: Mutation, run: () => Promise<T>) {
    // Call through immediately: no fake delay outside the SDK's queue.
    const result = run();
    // The initialized store's resolved readiness continuation precedes this
    // microtask and installs the real write-chain link. Structured-field
    // writes enqueue synchronously. The predecessor is still held in persist.
    if (watched === mutation) queueMicrotask(() => queued.resolve());
    return result;
  }
  const f = await createAddressRetryHarness(surface, (store) => ({
    ...store,
    addRow: (...args) => observe("add", () => store.addRow(...args)),
    updateRowFields: (...args) =>
      observe("update", () => store.updateRowFields(...args)),
    removeRow: (...args) => observe("remove", () => store.removeRow(...args)),
    setStructuredFields: (...args) =>
      observe("flush", () => store.setStructuredFields(...args)),
  }));
  const commit = defaultDocumentsPersistence.commitDocumentMutation;
  defaultDocumentsPersistence.commitDocumentMutation = async (...args) => {
    if (hold) {
      hold = false;
      entered.resolve();
      await release.promise;
    }
    return commit(...args);
  };
  return {
    ...f,
    async blockPredecessor(preserveDirtyDelta = false) {
      hold = true;
      // A missing-row no-op revalidates identity without flushing dirty rows.
      const blocker = preserveDirtyDelta
        ? f.document.updateRowFields("missing-queue-barrier-row", {})
        : f.document.setStructuredFields("contact", {});
      owned.push(blocker);
      await reachedBeforeSettlement(entered.promise, blocker);
    },
    async enqueue(mutation: Mutation, run: () => Promise<unknown>) {
      watched = mutation;
      const settlement = run().then(
        (value) => ({ status: "fulfilled" as const, value }),
        (error: unknown) => ({ status: "rejected" as const, error }),
      );
      owned.push(settlement);
      await reachedBeforeSettlement(queued.promise, settlement);
      return { settlement };
    },
    release: () => release.resolve(),
    async releaseAndDrain() {
      release.resolve();
      await Promise.all(owned);
    },
    async close() {
      release.resolve();
      await Promise.allSettled(owned);
      defaultDocumentsPersistence.commitDocumentMutation = commit;
      f.close();
    },
  };
}
