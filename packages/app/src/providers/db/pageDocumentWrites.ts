/**
 * Every runtime mounted in this page that can hold document edits not yet in
 * SQLite. A reload the app itself starts asks them here before discarding
 * those edits, since native shells ignore the page's unload prompt. Each
 * runtime registers while mounted
 * (`useWarnBeforeUnloadWithPendingDocumentWrites`).
 */
const pendingWriteProbes = new Set<() => boolean>();

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
