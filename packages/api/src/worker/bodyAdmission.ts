/**
 * Concurrent requests share an isolate's heap. Reserve their worst-case bytes
 * before reading bodies or opening database pools, then keep the reservation
 * until the response drains. A sync POST reserves over half this budget, so
 * syncs serialize per isolate. Brief contention waits in a bounded FIFO;
 * sustained overload still returns 503 without raising the memory ceiling.
 * Small requests can use spare capacity without waiting behind a sync page.
 */
const BODY_ADMISSION_BYTES = 96 * 1024 * 1024;

interface PendingAdmission {
  readonly bytes: number;
  readonly resolve: () => void;
  state: "pending" | "granted" | "claimed" | "canceled";
}

export function createBodyAdmission({
  capacity = BODY_ADMISSION_BYTES,
  maxPending = 32,
  maxWaitMs = 30_000,
  maxBypassBytes = 2 * 1024 * 1024,
} = {}) {
  let held = 0;
  const pending: PendingAdmission[] = [];

  function grant(entry: PendingAdmission): void {
    entry.state = "granted";
    held += entry.bytes;
    entry.resolve();
  }

  function drain(): void {
    while (pending[0] && held + pending[0].bytes <= capacity) {
      const next = pending.shift();
      if (!next) break;
      grant(next);
    }
  }

  function release(bytes: number): void {
    held -= bytes;
    drain();
  }

  return {
    async acquire(
      bytes: number,
      signal?: AbortSignal,
      keepAlive?: (untilReleased: Promise<void>) => void,
    ) {
      if (signal?.aborted || bytes > capacity) return null;
      // Bodiless health checks and preflights never compete with sync pages.
      const immediate =
        held + bytes <= capacity &&
        (pending.length === 0 || bytes <= maxBypassBytes);
      if (!immediate && pending.length >= maxPending) return null;

      const { promise, resolve } = Promise.withResolvers<void>();
      const entry: PendingAdmission = { bytes, resolve, state: "pending" };
      const cancel = () => {
        if (entry.state === "pending") {
          const index = pending.indexOf(entry);
          if (index >= 0) pending.splice(index, 1);
          entry.state = "canceled";
          resolve();
          drain();
        } else if (entry.state === "granted") {
          // A disconnected workerd request may never resume its continuation.
          // Return an unclaimed grant synchronously in its abort listener.
          entry.state = "canceled";
          release(bytes);
        }
      };
      signal?.addEventListener("abort", cancel, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      if (immediate) grant(entry);
      else {
        pending.push(entry);
        timer = setTimeout(cancel, maxWaitMs);
      }
      try {
        await promise;
        if (entry.state === "canceled") return null;
        const lifetime = Promise.withResolvers<void>();
        let released = false;
        const releaseOnce = () => {
          if (released) return;
          released = true;
          release(bytes);
          lifetime.resolve();
        };
        try {
          // Register in this request's context before handing ownership to the
          // route. workerd must keep its cleanup alive after a disconnect.
          keepAlive?.(lifetime.promise);
        } catch (error) {
          releaseOnce();
          throw error;
        }
        // Once claimed, retain the bytes until route/stream cleanup finishes;
        // disconnect alone does not prove that a page builder has stopped.
        entry.state = "claimed";
        return releaseOnce;
      } finally {
        // Clean up in the waiting request's context, even when another request
        // releases the capacity that wakes it in workerd.
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
    inFlight: () => held,
  };
}
