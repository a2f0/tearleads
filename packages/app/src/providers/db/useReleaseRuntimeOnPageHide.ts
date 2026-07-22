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
// promptly. This also covers a killed worker whose graceful close is still
// pending: runtimeRef has already been cleared so the user can spawn a fresh
// worker after release, but a hard reload still needs to tear down the old
// runtime immediately. The worker-side install retry remains the backstop for
// the residual race where even this does not land before the new page boots.
export function useReleaseRuntimeOnPageHide(
  runtimeRef: RefObject<SQLiteRuntime | null>,
  runtimeReleaseRef?: RefObject<{
    readonly runtime: SQLiteRuntime | null;
  } | null>,
) {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handlePageHide = () => {
      const activeRuntime = runtimeRef.current;
      const releasingRuntime = runtimeReleaseRef?.current?.runtime ?? null;
      activeRuntime?.terminateNow();
      if (releasingRuntime && releasingRuntime !== activeRuntime) {
        releasingRuntime.terminateNow();
      }
    };
    // If the page is restored from the back-forward cache, the worker we
    // terminated on `pagehide` is gone and the client is destroyed — the app
    // would come back frozen. `pageshow` with `event.persisted` is the bfcache
    // restore signal; reload to re-initialize cleanly rather than running on a
    // dead database runtime.
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [runtimeRef, runtimeReleaseRef]);
}
