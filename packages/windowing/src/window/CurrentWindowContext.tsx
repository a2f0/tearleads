import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import type { WindowSize } from "./WindowStateProvider";

interface CurrentWindowContextValue {
  close: () => void;
  id: string;
  /**
   * Tell the window its content has loaded. A window opened with
   * `fitToContent` fits then, once the content has reported its size; later
   * calls do nothing. Hosts that render this provider outside a `Window` may
   * omit it.
   */
  markContentLoaded?: (() => void) | undefined;
  overlayHost: HTMLElement | null;
  /**
   * Paint the window's background with `background`, any CSS color, in place of
   * `--window-background`; `undefined` restores it. Hosts that render this
   * provider outside a `Window` may omit it.
   */
  setBackground?: ((background: string | undefined) => void) | undefined;
  /**
   * Record the content's natural size, which the window's Fit to Content sizes
   * it to; `undefined` withdraws it. Hosts that render this provider outside a
   * `Window` may omit it.
   */
  setContentSize?: ((size: WindowSize | undefined) => void) | undefined;
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
  markContentLoaded,
  overlayHost,
  setBackground,
  setContentSize,
  showStatusMessage,
  suppressToolbar,
}: PropsWithChildren<CurrentWindowContextValue>) {
  const value = useMemo(
    () => ({
      close,
      id,
      markContentLoaded,
      overlayHost,
      setBackground,
      setContentSize,
      showStatusMessage,
      suppressToolbar,
    }),
    [
      close,
      id,
      markContentLoaded,
      overlayHost,
      setBackground,
      setContentSize,
      showStatusMessage,
      suppressToolbar,
    ],
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
 *
 * Suppressing in a layout effect keeps the row from being painted alongside the
 * overlay's own toolbar for a frame and then resizing the pane out from under it.
 */
export function useSuppressWindowToolbar(active: boolean) {
  const suppressToolbar = useCurrentWindow()?.suppressToolbar;

  useLayoutEffect(() => {
    if (!active || !suppressToolbar) {
      return;
    }
    return suppressToolbar();
  }, [active, suppressToolbar]);
}

/**
 * Paint the host window's background, behind its body and sidebar, with
 * `background` (any CSS color) while mounted; `undefined` keeps the default,
 * `--window-background`. A document viewer uses it to set its page apart from
 * the window around it. Outside a window this is inert.
 *
 * Applying it in a layout effect keeps the default from being painted for a
 * frame before the content's own background.
 */
export function useWindowBackground(background: string | undefined) {
  const setBackground = useCurrentWindow()?.setBackground;

  useLayoutEffect(() => {
    if (background === undefined || !setBackground) {
      return;
    }
    setBackground(background);
    return () => setBackground(undefined);
  }, [background, setBackground]);
}

/**
 * Offer Fit to Content in the host window's View menu while mounted. It sizes
 * the window so its content area shows `size`, the content's natural size in
 * CSS pixels, as far as the desktop surface allows; content that still scrolls
 * gets room for its scrollbar. `undefined` withdraws the item. Outside a window
 * this is inert.
 */
export function useWindowContentSize(size: WindowSize | undefined) {
  const setContentSize = useCurrentWindow()?.setContentSize;
  const width = size?.width;
  const height = size?.height;

  useEffect(() => {
    if (width === undefined || height === undefined || !setContentSize) {
      return;
    }
    setContentSize({ height, width });
    return () => setContentSize(undefined);
  }, [height, setContentSize, width]);
}
