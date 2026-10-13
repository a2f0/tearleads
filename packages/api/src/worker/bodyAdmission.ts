/**
 * Concurrent requests share an isolate's heap. Reserve their worst-case bytes
 * before reading bodies or opening database pools, then keep the reservation
 * until the response drains. Brief contention waits in a bounded FIFO instead
 * of returning 503 for ordinary overlapping document syncs.
 */
const BODY_ADMISSION_BYTES = 96 * 1024 * 1024;

interface PendingAdmission {
  readonly bytes: number;
  readonly resolve: (admitted: boolean) => void;
}

export function createBodyAdmission({
  capacity = BODY_ADMISSION_BYTES,
  maxPending = 32,
  maxWaitMs = 30_000,
} = {}) {
  let held = 0;
  const pending: PendingAdmission[] = [];

  function drain(): void {
    while (pending[0] && held + pending[0].bytes <= capacity) {
      const next = pending.shift();
      if (!next) break;
      held += next.bytes;
      next.resolve(true);
    }
  }

  function release(bytes: number): void {
    held -= bytes;
    drain();
  }

  async function wait(bytes: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted || bytes > capacity) return false;
    // Bodiless health checks and preflights never compete with sync pages.
    if (bytes === 0 || (pending.length === 0 && held + bytes <= capacity)) {
      held += bytes;
      return true;
    }
    if (pending.length >= maxPending) return false;

    let cancel = () => {};
    const admitted = new Promise<boolean>((resolve) => {
      const entry = { bytes, resolve };
      pending.push(entry);
      cancel = () => {
        const index = pending.indexOf(entry);
        if (index === -1) return;
        pending.splice(index, 1);
        resolve(false);
        drain();
      };
    });
    const timer = setTimeout(cancel, maxWaitMs);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await admitted;
    } finally {
      // Clean up in the waiting request's context, even when another request
      // releases the capacity that wakes it in workerd.
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  return {
    async acquire(bytes: number, signal?: AbortSignal) {
      if (!(await wait(bytes, signal))) return null;
      if (signal?.aborted) {
        release(bytes);
        return null;
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        release(bytes);
      };
    },
    inFlight: () => held,
  };
}
