import { isIgnorableDatabaseWorkerError } from "../../../stores/explorer/documentRuntime";
import {
  type ExplorerRefreshEvent,
  type ExplorerRefreshState,
  IDLE_EXPLORER_REFRESH,
  transitionExplorerRefresh,
} from "./explorerRefreshMachine";

/** A root catch-up covers the root tree; a full refresh covers everything. */
export type ExplorerRefreshScope = "root" | "full";

interface ExplorerRefreshRun {
  readonly controller: AbortController;
  readonly outcome: Promise<boolean>;
  readonly request: object;
  readonly scope: ExplorerRefreshScope;
}

interface ExplorerRefreshEntry {
  readonly listeners: Set<() => void>;
  run: ExplorerRefreshRun | null;
  state: ExplorerRefreshState;
}

const REFRESH_FAILED_MESSAGE = "Failed to refresh explorer.";

/**
 * Explorer's refresh, kept per reconciler (one per scope) rather than per
 * window, so every open Explorer window shows the same run and any window's
 * Cancel reaches it. Closing a window leaves the run going, so the open
 * catch-up, which runs once per scope, still completes; a reopened window
 * shows it. A scope change brings a new reconciler, whose entry the old
 * scope's run never touches.
 */
const entries = new WeakMap<object, ExplorerRefreshEntry>();

function entryFor(key: object): ExplorerRefreshEntry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { listeners: new Set(), run: null, state: IDLE_EXPLORER_REFRESH };
    entries.set(key, entry);
  }
  return entry;
}

function dispatch(entry: ExplorerRefreshEntry, event: ExplorerRefreshEvent) {
  const next = transitionExplorerRefresh(entry.state, event);
  if (next === entry.state) {
    return;
  }
  entry.state = next;
  for (const listener of entry.listeners) {
    listener();
  }
}

function withdraw(entry: ExplorerRefreshEntry, run: ExplorerRefreshRun) {
  entry.run = null;
  dispatch(entry, { type: "cancelled", request: run.request });
  run.controller.abort(
    new DOMException("Explorer refresh cancelled", "AbortError"),
  );
}

export function subscribeExplorerRefresh(
  key: object,
  listener: () => void,
): () => void {
  const { listeners } = entryFor(key);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function explorerRefreshState(key: object): ExplorerRefreshState {
  return entries.get(key)?.state ?? IDLE_EXPLORER_REFRESH;
}

/**
 * Joins the running refresh when it covers `scope`. A full refresh asked for
 * during a root catch-up replaces it: Explorer withdraws from the catch-up,
 * which the full refresh covers, so no orphaned caller keeps it running.
 * Resolves true only when the run this caller joined succeeded.
 */
export function runExplorerRefresh(input: {
  readonly key: object;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly scope: ExplorerRefreshScope;
  readonly sweep: (signal: AbortSignal) => Promise<void>;
}): Promise<boolean> {
  const entry = entryFor(input.key);
  const current = entry.run;
  if (current && (current.scope === "full" || input.scope === "root")) {
    return current.outcome;
  }
  if (current) {
    withdraw(entry, current);
  }

  const request = {};
  const controller = new AbortController();
  const settle = (event: ExplorerRefreshEvent) => {
    if (entry.run?.request === request) {
      entry.run = null;
    }
    dispatch(entry, event);
  };
  dispatch(entry, { type: "started", request });
  const outcome = input.sweep(controller.signal).then(
    () => {
      settle({ type: "succeeded", request });
      return true;
    },
    (error: unknown) => {
      if (controller.signal.aborted) {
        return false;
      }
      if (isIgnorableDatabaseWorkerError(error)) {
        settle({ type: "interrupted", request });
      } else {
        input.logError("Failed to refresh explorer", error);
        settle({ type: "failed", message: REFRESH_FAILED_MESSAGE, request });
      }
      return false;
    },
  );
  entry.run = { controller, outcome, request, scope: input.scope };
  return outcome;
}

/** Withdraws Explorer from the running refresh, from any window. */
export function cancelExplorerRefresh(key: object): void {
  const entry = entries.get(key);
  if (entry?.run) {
    withdraw(entry, entry.run);
  }
}
