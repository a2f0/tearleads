import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { type RefObject, useEffect } from "react";

// Release the worker on page unload so its persistent SAHPool VFS frees its
// exclusive OPFS access handles before the next page boots.
//
// This is the crux of the reload fix. On a hard reload/navigation React never
// unmounts, so the lifecycle cleanup that would destroy the runtime does not
// run; the old page's worker keeps its OPFS handles, and the browser may keep
// that discarded worker alive long enough that the *next* page's SAHPool install
// loses the lock-contention race and the database fails to boot. `pagehide` is
// the reliable unload signal (it also covers bfcache eviction, unlike
// `beforeunload`).
//
// We terminate the worker *synchronously* here rather than going through the
// async graceful close: an unload handler has no time to await a worker
// round-trip, and terminating the worker thread releases its OPFS handles
// promptly. The worker-side install retry remains the backstop for the residual
// race where even this does not land before the new page boots.
export function useReleaseRuntimeOnPageHide(
  runtimeRef: RefObject<SQLiteRuntime | null>,
) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePageHide = () => {
      runtimeRef.current?.terminateNow();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [runtimeRef]);
}
