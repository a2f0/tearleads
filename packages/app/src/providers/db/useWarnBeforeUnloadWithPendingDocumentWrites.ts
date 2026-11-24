import {
  type DomainScope,
  hasPendingLocalDocumentWrites,
} from "@tearleads/client-sdk";
import { useEffect } from "react";
import {
  isReloadDiscardingPageDocumentWrites,
  registerPageDocumentWrites,
} from "./pageDocumentWrites";

/**
 * Ask before leaving the page while any open document still holds local edits
 * that have not reached SQLite.
 *
 * Document writes reach SQLite through a queue that lives only in memory, and
 * `pagehide` must terminate the SQLite worker synchronously so its OPFS access
 * handles are free for the next page (see useReleaseRuntimeOnPageHide). Any
 * edit still queued at that point is lost, so `beforeunload` is the only chance
 * to keep it: cancelling the unload gives the queue time to drain.
 *
 * Browsers only show the prompt after the page has had user activation, and
 * native shells (Capacitor WebView, Electrobun) may ignore it entirely; there
 * the guard is a harmless no-op. So a reload the app itself starts asks
 * first: the same check is registered for the page while mounted
 * (`registerPageDocumentWrites`), and once its user chose to lose the edits,
 * that reload asks nothing more (`reloadDiscardingPageDocumentWrites`).
 * The scope is read at event time so the
 * check always covers every open document in the current domain scope.
 */
export function useWarnBeforeUnloadWithPendingDocumentWrites(
  sdk: { readonly domainScope: DomainScope },
  hasPendingWrites: (
    domainScope: DomainScope,
  ) => boolean = hasPendingLocalDocumentWrites,
): void {
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const pending = () => hasPendingWrites(sdk.domainScope);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      // The app already asked about these edits before its own reload.
      if (isReloadDiscardingPageDocumentWrites() || !pending()) {
        return;
      }
      event.preventDefault();
      // Older browsers only prompt when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    const unregister = registerPageDocumentWrites(pending);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unregister();
    };
  }, [sdk, hasPendingWrites]);
}
