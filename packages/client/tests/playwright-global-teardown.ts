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
 * Force-close a handle to allow process exit.
 */
function forceCloseHandle(handle: unknown): void {
  if (!handle || typeof handle !== 'object') return;

  const h = handle as Record<string, unknown>;

  // Try various cleanup methods
  if (typeof h['destroy'] === 'function') {
    try {
      (h['destroy'] as () => void)();
    } catch {
      // ignore
    }
  } else if (typeof h['close'] === 'function') {
    try {
      (h['close'] as () => void)();
    } catch {
      // ignore
    }
  } else if (typeof h['end'] === 'function') {
    try {
      (h['end'] as () => void)();
    } catch {
      // ignore
    }
  } else if (typeof h['unref'] === 'function') {
    try {
      (h['unref'] as () => void)();
    } catch {
      // ignore
    }
  }

  // For ChildProcess, try to kill
  if (typeof h['kill'] === 'function') {
    try {
      (h['kill'] as (signal?: string) => void)('SIGTERM');
    } catch {
      // ignore
    }
  }
}

export default async function globalTeardown(): Promise<void> {
  const debugHandles = process.env['PW_DEBUG_HANDLES'] === 'true';
  const forceCleanup = process.env['PW_FORCE_CLEANUP'] === 'true';

  const handles = process._getActiveHandles?.() ?? [];
  const requests = process._getActiveRequests?.() ?? [];

  if (debugHandles) {
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

  // Force cleanup handles to prevent process hang
  if (forceCleanup) {
    console.log('[playwright] forcing cleanup of', handles.length, 'handles...');
    for (const handle of handles) {
      forceCloseHandle(handle);
    }
  }
}
