import { classifyDatabaseFailure } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

const lastWriteFailureByState = new WeakMap<DocumentStoreState, string>();

// Both host callbacks are declared `=> void` but may be async (see
// Tearleads.logError), and every call site here sits inside a write-chain
// `.catch`, where a throw would reject the chain a caller awaits.
function dispatchToHost(call: () => unknown): void {
  try {
    void Promise.resolve(call()).catch(() => undefined);
  } catch {
    // Hosts may throw synchronously or return a rejected promise.
  }
}

/**
 * Log a note about a local write through the host. It runs between a write's
 * mutation and its save, so it must stay purely observational too: a host
 * logger that throws or rejects changes nothing.
 */
export function noteDocumentStoreWrite(
  state: DocumentStoreState,
  message: string,
): void {
  dispatchToHost(() => state.runtime.util.log(message));
}

/**
 * Report a failed local write through the host's diagnostics. The write chain
 * already swallowed the error to keep an un-awaited `setText` from rejecting,
 * so this is the only place the loss is observable — and it must stay purely
 * observational: a host logger that throws or rejects changes nothing.
 */
export function reportDocumentStoreWriteFailure(
  state: DocumentStoreState,
  message: string,
  error: unknown,
): void {
  // A vanished database is teardown, not lost durability: the runtime is
  // released under in-flight callers on every identity switch, logout, and
  // Explorer retry, and neither persistDocument nor saveDocumentRecord filters
  // it. Unfiltered, SQLite-worker teardown would outrank every real failure.
  // A busy refusal still reports here: only `reportOrRetryBusyDocumentWrite`
  // callers queue the write again, and a refusal nothing retries is lost work.
  if (classifyDatabaseFailure(error) === "unavailable") {
    dispatchToHost(() => state.runtime.util.log(message));
    return;
  }

  const { logError } = state.runtime.util;
  // Hosts without an Error-preserving logger keep the string-only local line
  // they have today. Nothing reached diagnostics, so nothing is suppressed.
  if (!logError) {
    dispatchToHost(() => state.runtime.util.log(message));
    return;
  }

  // `String` renders an Error as `name: message` — the same identity the sync
  // quarantine signature keeps, and total over an `unknown` catch value. The
  // message joins it so one broken database still reports each failing site.
  const signature = JSON.stringify([message, String(error)]);
  if (lastWriteFailureByState.get(state) === signature) return;
  // Suppress repeats before the host appends local logs and breadcrumbs: one
  // broken database fails every keystroke of a burst. Keyed on the store state,
  // not the write — a dropped-file import builds one store per file, so a
  // per-write key would report all 200 files of a failing import.
  lastWriteFailureByState.set(state, signature);
  dispatchToHost(() => logError(message, error));
}

/**
 * How long a local write the worker refused behind another tab's transaction
 * waits before it is queued again. The SDK's worker already waited its 5 s
 * lease bound before refusing; this only spaces out a host that refuses at
 * once.
 */
export const BUSY_WRITE_RETRY_MS = 1_000;

interface BusyWriteRetry {
  doc: DocumentState | null;
  requeue: () => unknown;
  writeGeneration: number;
}

const retriesByState = new WeakMap<DocumentStoreState, BusyWriteRetry>();

function settleBusyWriteRetry(state: DocumentStoreState): void {
  const retry = retriesByState.get(state);
  retriesByState.delete(state);
  // Only a write that is still the newest word on this document runs again.
  // Another write in flight carries the same unsaved edits on its own persist,
  // a saved edit leaves nothing to carry, and a reset owns a new document.
  if (
    !retry ||
    state.localWriteGeneration !== retry.writeGeneration ||
    state.doc !== retry.doc ||
    !state.unsavedLocalEdits ||
    state.pendingLocalWrites > 0
  ) {
    return;
  }
  try {
    void Promise.resolve(retry.requeue()).catch(() => undefined);
  } catch {
    // The requeued write reports its own failure.
  }
}

/**
 * Reports a failed local write, or, when the worker refused its persist behind
 * another tab's transaction (#3360), logs it locally and queues the write
 * again. The refused persist ran nothing, so its edits are in the live
 * document but not in SQLite, and before this only the next edit saved them.
 * Later refusals replace the pending retry, so one timer runs per store and
 * the newest write is the one queued again; that write's delta covers every
 * unsaved edit before it.
 */
export function reportOrRetryBusyDocumentWrite(
  state: DocumentStoreState,
  message: string,
  error: unknown,
  writeGeneration: number,
  requeue: () => unknown,
): void {
  if (classifyDatabaseFailure(error) !== "busy") {
    reportDocumentStoreWriteFailure(state, message, error);
    return;
  }
  dispatchToHost(() =>
    state.runtime.util.log(
      `${message} behind another tab's database transaction`,
    ),
  );
  const pending = retriesByState.get(state);
  const retry: BusyWriteRetry = { doc: state.doc, requeue, writeGeneration };
  retriesByState.set(state, retry);
  if (!pending) {
    setTimeout(() => settleBusyWriteRetry(state), BUSY_WRITE_RETRY_MS);
  }
}
