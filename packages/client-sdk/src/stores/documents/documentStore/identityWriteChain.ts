import type { DocumentStoreState } from "./state";

const identityWriteChains = new WeakMap<DocumentStoreState, Promise<void>>();

/**
 * Run a record-identity write behind every previously chained one for this
 * store. Identity writers (the eager create's persist, relink, the sync
 * finalize persist) run from independent contexts — the sync lane vs. external
 * callers — and each reads the record before a multi-await persist, so
 * unserialized they race: a create that captured a null identity before its
 * network round trip can write the derived documentId over a relink's
 * just-assigned one. On the chain, whichever runs second sees the first's
 * result (the create aborts, or the relink's patch overrides). The task must
 * read the live record inside the chain (never a value captured before
 * chaining) — that read-then-persist being uninterleaved is the point.
 */
export function chainIdentityWrite<T>(
  state: DocumentStoreState,
  task: () => Promise<T>,
): Promise<T> {
  const chain = identityWriteChains.get(state) ?? Promise.resolve();
  const result = chain.then(task);
  identityWriteChains.set(
    state,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
