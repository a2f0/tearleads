import { isDatabaseUnavailableError } from "../../../workflows/documents";
import type { DocumentStoreState } from "./state";

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
  if (isDatabaseUnavailableError(error)) {
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
