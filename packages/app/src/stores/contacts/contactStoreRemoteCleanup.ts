import type { ContactsStoreState } from "./contactStoreTypes";

interface PendingCleanup {
  current: () => boolean;
  replacementLocalId: string;
  running: boolean;
  retryRequested: boolean;
  run: () => Promise<boolean>;
}

const pendingByState = new WeakMap<
  ContactsStoreState,
  Map<string, PendingCleanup>
>();

/**
 * Resolve at submission and the queue boundary: cleanup can finish between them,
 * but an accepted edit still belongs to the retained self contact.
 */
export function resolveContactWriteTarget(
  state: ContactsStoreState,
  localId: string,
): string {
  const pending = pendingByState.get(state);
  const visited = new Set<string>();
  let target = localId;
  for (;;) {
    const cleanup = pending?.get(target);
    if (!cleanup?.current()) return target;
    if (visited.has(target))
      throw new Error("Contact cleanup targets form a cycle");
    visited.add(target);
    target = cleanup.replacementLocalId;
  }
}

/** Remote duplicate cleanup must never occupy the local contact write queue. */
export function resumeRemoteContactCleanup(
  state: ContactsStoreState,
  retryRunning = true,
): void {
  const pending = pendingByState.get(state);
  if (!pending) return;
  const runtime = state.runtime.documents;
  for (const [localId, cleanup] of pending) {
    if (!cleanup.current()) {
      pending.delete(localId);
      continue;
    }
    if (
      runtime.infra.dbStatus !== "ready" ||
      !runtime.state.online ||
      !runtime.auth.isAuthenticated
    ) {
      continue;
    }
    if (cleanup.running) {
      cleanup.retryRequested ||= retryRunning;
      continue;
    }
    cleanup.running = true;
    void cleanup
      .run()
      .then((completed) => {
        if (completed && pending.get(localId) === cleanup) {
          pending.delete(localId);
        }
      })
      .catch((error: unknown) => {
        state.dependencies.logError(
          "Contacts: failed to clean up a remote duplicate self contact.",
          error,
        );
      })
      .finally(() => {
        cleanup.running = false;
        if (cleanup.retryRequested && pending.get(localId) === cleanup) {
          cleanup.retryRequested = false;
          resumeRemoteContactCleanup(state, false);
        }
      });
  }
}

export function scheduleRemoteContactCleanup(input: {
  current: () => boolean;
  localId: string;
  replacementLocalId: string;
  run: () => Promise<boolean>;
  state: ContactsStoreState;
}): void {
  const pending = pendingByState.get(input.state) ?? new Map();
  pendingByState.set(input.state, pending);
  const existing = pending.get(input.localId);
  if (!existing || !existing.current()) {
    const replacementLocalId = resolveContactWriteTarget(
      input.state,
      input.replacementLocalId,
    );
    if (replacementLocalId === input.localId)
      throw new Error("Contact cleanup cannot retire its retained target");
    pending.set(input.localId, {
      current: input.current,
      replacementLocalId,
      running: false,
      retryRequested: false,
      run: input.run,
    });
  }
  resumeRemoteContactCleanup(input.state, false);
}

export function resetRemoteContactCleanup(state: ContactsStoreState): void {
  pendingByState.delete(state);
}
