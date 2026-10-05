import { type RefObject, useCallback, useMemo, useState } from "react";
import { useWindowGeometryMenuItems } from "./useWindowKeyboardGeometry";
import type { WindowMenuItem } from "./WindowMenuBar";
import {
  useWindowActions,
  type WindowEntry,
  type WindowSize,
} from "./WindowStateProvider";
import { fitWindowGeometry, type WindowFitMetrics } from "./windowGeometry";

const SCROLL_PANE_SELECTOR =
  ":scope > .window-body-content-scroll, :scope > .window-sidebar-content-scroll";

// The pane's scrollbars, forced on before its own overflow is put back. Layout
// is read between the writes, so nothing is painted meanwhile.
function measureScrollbars(pane: HTMLElement): WindowSize {
  const { overflow } = pane.style;
  pane.style.overflow = "scroll";
  const scrollbar = {
    height: pane.offsetHeight - pane.clientHeight,
    width: pane.offsetWidth - pane.clientWidth,
  };
  pane.style.overflow = overflow;
  return scrollbar;
}

function measureWindowFit(
  windowElement: HTMLElement,
  pane: HTMLElement,
): WindowFitMetrics {
  const frame = windowElement.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const style = getComputedStyle(pane);
  const px = (value: string) => Number.parseFloat(value) || 0;

  return {
    chrome: {
      height: frame.height - paneRect.height,
      width: frame.width - paneRect.width,
    },
    padding: {
      height: px(style.paddingTop) + px(style.paddingBottom),
      width: px(style.paddingLeft) + px(style.paddingRight),
    },
    scrollbar: measureScrollbars(pane),
  };
}

interface WindowFitHost {
  overlayHost: HTMLElement | null;
  windowRef: RefObject<HTMLElement | null>;
}

// Fit to Content, offered in the View menu while the window's content has a
// natural size (see `useWindowContentSize`). It measures the window's chrome
// as rendered, so it allows for whichever bars and sidebar show, and restores
// a maximized window first.
function useWindowFit(
  entry: WindowEntry,
  { overlayHost, windowRef }: WindowFitHost,
) {
  const { setGeometry, toggleMaximize } = useWindowActions();
  const [contentSize, setContentSize] = useState<WindowSize | undefined>();
  const { id, maximized, position } = entry;

  const fitToContent = useCallback(() => {
    const element = windowRef.current;
    const surface = element?.parentElement;
    const pane = overlayHost?.querySelector<HTMLElement>(SCROLL_PANE_SELECTOR);
    if (!contentSize || !element || !surface || !pane) {
      return;
    }
    const geometry = fitWindowGeometry(
      contentSize,
      measureWindowFit(element, pane),
      { height: surface.clientHeight, width: surface.clientWidth },
      position ?? { x: 0, y: 0 },
    );
    if (maximized) {
      toggleMaximize(id);
    }
    setGeometry(id, geometry);
  }, [
    contentSize,
    id,
    maximized,
    overlayHost,
    position,
    setGeometry,
    toggleMaximize,
    windowRef,
  ]);

  const fitMenuItems = useMemo<WindowMenuItem[]>(
    () =>
      contentSize
        ? [
            {
              id: "fit-to-content",
              label: "Fit to Content",
              onClick: fitToContent,
            },
          ]
        : [],
    [contentSize, fitToContent],
  );

  return { fitMenuItems, setContentSize };
}

// The View menu's geometry entries: keyboard move and resize, then Fit to
// Content while the content has a natural size.
export function useWindowGeometryMenu(
  entry: WindowEntry,
  stepped: Parameters<typeof useWindowGeometryMenuItems>[0],
  host: WindowFitHost,
  announce: (message: string) => void,
) {
  const keyboardItems = useWindowGeometryMenuItems(
    stepped,
    {
      maximized: entry.maximized,
      minimized: entry.minimized,
      windowRef: host.windowRef,
    },
    announce,
  );
  const { fitMenuItems, setContentSize } = useWindowFit(entry, host);
  const geometryMenuItems = useMemo(
    () => [...keyboardItems, ...fitMenuItems],
    [fitMenuItems, keyboardItems],
  );

  return { geometryMenuItems, setContentSize };
}
