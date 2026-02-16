/**
 * Playwright global teardown that ensures clean process exit.
 *
 * Handles two scenarios:
 * 1. Normal exit: unrefs remaining handles to allow graceful shutdown
 * 2. Force exit: kills child processes and calls process.exit() when PW_FORCE_EXIT=true
 *
 * Environment variables:
 * - PW_FORCE_EXIT=true: Force process.exit() after cleanup (for CI/scripts)
 * - PW_DEBUG_HANDLES=true: Log detailed handle information for debugging
 */

const getHandleLabel = (item: unknown): string => {
  if (item && typeof item === 'object') {
    const ctor = (item as { constructor?: { name?: string } }).constructor;
    if (ctor?.name) {
      return ctor.name;
    }
  }
  return Object.prototype.toString.call(item);
};

const summarizeHandles = (items: unknown[]): string => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getHandleLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} x${count}`)
    .join(', ');
};

function forceCloseHandle(handle: unknown): void {
  if (!handle || typeof handle !== 'object') return;

  const record = handle as Record<string, unknown>;
  const label = getHandleLabel(handle);

  try {
    // Kill child processes
    if (label === 'ChildProcess' && typeof record['kill'] === 'function') {
      const pid = record['pid'];
      if (typeof pid === 'number') {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // Ignore - process may already be dead
        }
      }
      (record['kill'] as (signal?: string) => boolean)('SIGKILL');
      return;
    }

    // Close sockets, pipes, streams
    if (typeof record['destroy'] === 'function') {
      (record['destroy'] as () => void)();
      return;
    }

    // Unref to allow process exit
    if (typeof record['unref'] === 'function') {
      (record['unref'] as () => void)();
    }
  } catch {
    // Ignore errors during cleanup
  }
}

export default async function globalTeardown(): Promise<void> {
  const debugHandles = process.env['PW_DEBUG_HANDLES'] === 'true';
  const forceExit = process.env['PW_FORCE_EXIT'] === 'true';

  const handles = process._getActiveHandles?.() ?? [];

  // Log handle info if debugging
  if (debugHandles && handles.length > 0) {
    console.log(`[teardown] handles: ${handles.length} (${summarizeHandles(handles)})`);
  }

  // Unref all handles to allow graceful exit
  for (const handle of handles) {
    if (!handle || typeof handle !== 'object') continue;
    const h = handle as Record<string, unknown>;
    try {
      if (typeof h['unref'] === 'function') {
        (h['unref'] as () => void)();
      }
    } catch {
      // Ignore
    }
  }

  if (forceExit) {
    // Kill any remaining child processes
    for (const handle of handles) {
      if (getHandleLabel(handle) === 'ChildProcess') {
        forceCloseHandle(handle);
      }
    }

    // Force exit - don't wait for event loop
    process.exit(process.exitCode ?? 0);
  }
}
