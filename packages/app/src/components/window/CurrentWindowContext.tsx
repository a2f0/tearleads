import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
} from "react";

interface CurrentWindowContextValue {
  close: () => void;
  id: string;
  overlayHost: HTMLElement | null;
  showStatusMessage: (message: string) => void;
  /**
   * Hide the window's toolbar row until the returned release is called. Refcounted,
   * so overlapping suppressions restore the row only once the last one releases.
   */
  suppressToolbar: () => () => void;
}

const CurrentWindowContext = createContext<CurrentWindowContextValue | null>(
  null,
);

export function CurrentWindowProvider({
  children,
  close,
  id,
  overlayHost,
  showStatusMessage,
  suppressToolbar,
}: PropsWithChildren<CurrentWindowContextValue>) {
  const value = useMemo(
    () => ({ close, id, overlayHost, showStatusMessage, suppressToolbar }),
    [close, id, overlayHost, showStatusMessage, suppressToolbar],
  );

  return (
    <CurrentWindowContext.Provider value={value}>
      {children}
    </CurrentWindowContext.Provider>
  );
}

export function useCurrentWindow() {
  return useContext(CurrentWindowContext);
}

/**
 * Drop the host window's toolbar row while `active`.
 *
 * A full-pane overlay (the image viewer) carries its own toolbar, and the
 * window's row would otherwise stack directly above it — two toolbars, one of
 * them driving chrome the overlay covers. Outside a window this is inert, since
 * the routed shell's overlays cover the whole viewport already.
 */
export function useSuppressWindowToolbar(active: boolean) {
  const suppressToolbar = useCurrentWindow()?.suppressToolbar;

  useEffect(() => {
    if (!active || !suppressToolbar) {
      return;
    }
    return suppressToolbar();
  }, [active, suppressToolbar]);
}
