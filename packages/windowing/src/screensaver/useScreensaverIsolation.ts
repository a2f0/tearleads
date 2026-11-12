import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

// The modal isolates the page while visible. Keep that isolation through the
// release/click tail too: iframe events cannot be intercepted by their host.
// Per HTML 6.3.1, a showModal() dialog escapes ancestor inertness; only inert
// on the dialog itself would hide it. Keep the body lock across modal removal.
export function useScreensaverIsolation(engaged: boolean) {
  const previousFocus = useRef<Element | null>(null);
  const rememberFocus = useCallback(() => {
    previousFocus.current = document.activeElement;
  }, []);
  useLayoutEffect(() => {
    if (!engaged) return;
    const body = document.body;
    const wasInert = body.inert;
    body.inert = true;
    return () => {
      body.inert = wasInert;
    };
  }, [engaged]);
  // Restore after React's commit-time selection restoration, not in the layout
  // cleanup which runs before it. A host that moved focus elsewhere keeps it.
  useEffect(() => {
    if (!engaged) return;
    const focus = previousFocus.current;
    return () => {
      if (document.activeElement !== document.body) return;
      if (focus instanceof HTMLElement && focus.isConnected) {
        focus.focus({ preventScroll: true });
      }
    };
  }, [engaged]);
  return rememberFocus;
}
