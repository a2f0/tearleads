/**
 * Every runtime mounted in this page that can hold document edits not yet in
 * SQLite. A reload the app itself starts asks them here before discarding
 * those edits, since native shells ignore the page's unload prompt. Each
 * runtime registers while mounted
 * (`useWarnBeforeUnloadWithPendingDocumentWrites`).
 */
const pendingWriteProbes = new Set<() => boolean>();

/**
 * True only inside `reloadDiscardingPageDocumentWrites`, while a reload whose
 * edits the user already chose to lose runs.
 */
let reloadDiscardingWrites = false;

/** Registers `probe` until the returned function removes it. */
export function registerPageDocumentWrites(probe: () => boolean): () => void {
  pendingWriteProbes.add(probe);
  return () => {
    pendingWriteProbes.delete(probe);
  };
}

/** Whether any runtime in this page holds edits not yet in SQLite. */
export function hasPendingPageDocumentWrites(): boolean {
  for (const probe of pendingWriteProbes) {
    if (probe()) return true;
  }
  return false;
}

/**
 * Runs `reload` after the app's own question about unsaved edits, so the
 * page's unload prompt does not ask again. Chromium and Firefox dispatch
 * `beforeunload` inside `location.reload()`, so only that reload's prompt is
 * skipped; the flag is down again before any other navigation can start.
 * WebKit dispatches it after the call returns, so Safari still asks.
 */
export function reloadDiscardingPageDocumentWrites(reload: () => void): void {
  reloadDiscardingWrites = true;
  try {
    reload();
  } finally {
    reloadDiscardingWrites = false;
  }
}

/** Whether the unload under way is a reload whose edits the user discarded. */
export function isReloadDiscardingPageDocumentWrites(): boolean {
  return reloadDiscardingWrites;
}
