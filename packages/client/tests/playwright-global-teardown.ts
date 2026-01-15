import util from 'node:util';

const getHandleLabel = (item: unknown): string => {
  if (item && typeof item === 'object') {
    const ctor = (item as { constructor?: { name?: string } }).constructor;
    if (ctor?.name) {
      return ctor.name;
    }
  }
  return Object.prototype.toString.call(item);
};

const summarizeObjects = (items: unknown[]): string[] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = getHandleLabel(item);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} x${count}`);
};

const formatHandle = (handle: unknown): string => {
  if (!handle || typeof handle !== 'object') {
    return String(handle);
  }

  const record = handle as Record<string, unknown>;
  const summary: Record<string, unknown> = {};

  if (typeof record['timeout'] === 'number') {
    summary['timeout'] = record['timeout'];
  }
  if (typeof record['_idleTimeout'] === 'number') {
    summary['idleTimeout'] = record['_idleTimeout'];
  }
  if (typeof record['_idleStart'] === 'number') {
    summary['idleStart'] = record['_idleStart'];
  }
  if (typeof record['localPort'] === 'number') {
    summary['localPort'] = record['localPort'];
  }
  if (typeof record['remotePort'] === 'number') {
    summary['remotePort'] = record['remotePort'];
  }
  if (typeof record['remoteAddress'] === 'string') {
    summary['remoteAddress'] = record['remoteAddress'];
  }
  if (typeof record['listening'] === 'boolean') {
    summary['listening'] = record['listening'];
  }
  if (typeof record['readable'] === 'boolean') {
    summary['readable'] = record['readable'];
  }
  if (typeof record['writable'] === 'boolean') {
    summary['writable'] = record['writable'];
  }

  // For ChildProcess, include PID and spawn info
  if (typeof record['pid'] === 'number') {
    summary['pid'] = record['pid'];
  }
  if (typeof record['spawnfile'] === 'string') {
    summary['spawnfile'] = record['spawnfile'];
  }
  if (Array.isArray(record['spawnargs'])) {
    summary['spawnargs'] = (record['spawnargs'] as string[]).slice(0, 3);
  }

  return `${getHandleLabel(handle)} ${util.inspect(summary, {
    depth: 1,
    breakLength: 80,
    maxArrayLength: 5
  })}`;
};

/**
 * Expected handles that are normal after tests complete.
 * These are typically internal Node.js handles that don't prevent exit.
 */
const EXPECTED_HANDLE_TYPES = new Set([
  'Socket',      // Internal Node.js sockets (stdio, etc.)
  'WriteStream', // stdout/stderr
  'ReadStream',  // stdin
  'Pipe',        // IPC channels (Playwright workers, etc.)
]);

/**
 * Check if a ChildProcess is Playwright-related (webServer or worker).
 * Playwright manages these and terminates them after globalTeardown.
 */
function isPlaywrightProcess(handle: unknown): boolean {
  if (!handle || typeof handle !== 'object') return false;
  const record = handle as Record<string, unknown>;
  if (getHandleLabel(handle) !== 'ChildProcess') return false;

  const spawnargs = record['spawnargs'];
  if (Array.isArray(spawnargs)) {
    const argsStr = spawnargs.join(' ');
    // webServer (Vite dev server)
    if (argsStr.includes('pnpm run dev') || argsStr.includes('npm run dev') ||
        argsStr.includes('vite') || argsStr.includes('webpack serve')) {
      return true;
    }
    // Playwright worker processes
    if (argsStr.includes('playwright/lib/common/process.js') ||
        argsStr.includes('playwright/lib/') ||
        argsStr.includes('@playwright/')) {
      return true;
    }
  }
  return false;
}

/**
 * Maximum number of handles considered acceptable.
 * With parallel workers, Playwright may have many internal handles.
 */
const MAX_EXPECTED_HANDLES = 30;

/**
 * Check if a handle is an "expected" type that doesn't indicate a leak.
 */
function isExpectedHandle(handle: unknown): boolean {
  const label = getHandleLabel(handle);
  if (EXPECTED_HANDLE_TYPES.has(label)) return true;
  // Allow Playwright's internal processes (webServer, workers)
  if (isPlaywrightProcess(handle)) return true;
  return false;
}

/**
 * Force-close a handle to allow process exit.
 */
function forceCloseHandle(handle: unknown): void {
  if (!handle || typeof handle !== 'object') return;

  const record = handle as Record<string, unknown>;
  const label = getHandleLabel(handle);

  try {
    // Kill child processes
    if (label === 'ChildProcess' && typeof record['kill'] === 'function') {
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

  const handles = process._getActiveHandles?.() ?? [];
  const requests = process._getActiveRequests?.() ?? [];

  // Separate handles into expected and unexpected
  const unexpectedHandles = handles.filter((h) => !isExpectedHandle(h));
  const hasUnexpectedHandles = unexpectedHandles.length > 0;
  const tooManyHandles = handles.length > MAX_EXPECTED_HANDLES;

  // Always log if there are issues, or if debug mode is on
  if (debugHandles || hasUnexpectedHandles || tooManyHandles) {
    console.log('[playwright] active handles:', handles.length);
    if (handles.length > 0) {
      console.log('[playwright] handle summary:', summarizeObjects(handles).join(', '));
      handles.slice(0, 20).forEach((handle, index) => {
        console.log(`[playwright] handle ${index + 1}:`, formatHandle(handle));
      });
    }

    console.log('[playwright] active requests:', requests.length);
    if (requests.length > 0) {
      console.log('[playwright] request summary:', summarizeObjects(requests).join(', '));
      requests.slice(0, 20).forEach((request, index) => {
        console.log(`[playwright] request ${index + 1}:`, formatHandle(request));
      });
    }
  }

  // Build error message if there are leaks
  let errorMessage: string | null = null;

  if (hasUnexpectedHandles) {
    const unexpectedSummary = summarizeObjects(unexpectedHandles).join(', ');
    errorMessage =
      `Handle leak detected! Found ${unexpectedHandles.length} unexpected handles: ${unexpectedSummary}\n` +
      `This indicates tests are not properly cleaning up resources.\n` +
      `Run with PW_DEBUG_HANDLES=true to see full details.`;
  } else if (tooManyHandles) {
    errorMessage =
      `Too many handles open (${handles.length} > ${MAX_EXPECTED_HANDLES})!\n` +
      `This may indicate a resource leak. Run with PW_DEBUG_HANDLES=true to investigate.`;
  }

  // Force-close unexpected handles to allow process exit
  if (hasUnexpectedHandles || tooManyHandles) {
    for (const handle of unexpectedHandles) {
      forceCloseHandle(handle);
    }
  }

  // Throw after cleanup so process can exit
  if (errorMessage) {
    throw new Error(errorMessage);
  }
}
