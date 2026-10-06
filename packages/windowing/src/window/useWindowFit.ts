import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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

// A window opened with `fitToContent` fits once, the first time its content
// has both marked itself loaded and reported a size while the window shows. A
// window maximized by then (as a host opens windows on narrow screens, before
// they are ever laid out) stays maximized and does not fit later. A hidden
// surface (an inactive workspace) has no size to fit against, so the fit waits
// until it has one.
function useFitOnLoad(
  entry: WindowEntry,
  contentSize: WindowSize | undefined,
  fit: () => boolean,
  windowRef: RefObject<HTMLElement | null>,
) {
  const [loaded, setLoaded] = useState(false);
  const pending = useRef(entry.fitToContent === true);
  const markContentLoaded = useCallback(() => setLoaded(true), []);
  const { maximized, minimized, position } = entry;

  useEffect(() => {
    if (!pending.current || !loaded || minimized) {
      return;
    }
    if (maximized) {
      pending.current = false;
      return;
    }
    if (!contentSize) {
      return;
    }
    const attempt = () => {
      if (fit()) {
        pending.current = false;
      }
      return !pending.current;
    };
    if (!position || attempt()) {
      return;
    }
    const surface = windowRef.current?.parentElement;
    if (!surface || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      if (attempt()) {
        observer.disconnect();
      }
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, [contentSize, fit, loaded, maximized, minimized, position, windowRef]);

  return markContentLoaded;
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

  // Whether the window fitted: one that is not rendered, or whose surface is
  // hidden, has nothing to measure.
  const fitToContent = useCallback(() => {
    const element = windowRef.current;
    const surface = element?.parentElement;
    const pane = overlayHost?.querySelector<HTMLElement>(SCROLL_PANE_SELECTOR);
    if (
      !contentSize ||
      !element ||
      !surface ||
      !pane ||
      (surface.clientWidth === 0 && surface.clientHeight === 0)
    ) {
      return false;
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
    return true;
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

  const markContentLoaded = useFitOnLoad(
    entry,
    contentSize,
    fitToContent,
    windowRef,
  );

  return { fitMenuItems, markContentLoaded, setContentSize };
}

// The View menu's geometry entries: keyboard move and resize, then Fit to
// Content while the content has a natural size. `contentFit` is the content's
// side of fitting, `setContentSize` and `markContentLoaded`, which the window
// passes to its content.
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
  const { fitMenuItems, ...contentFit } = useWindowFit(entry, host);
  const geometryMenuItems = useMemo(
    () => [...keyboardItems, ...fitMenuItems],
    [fitMenuItems, keyboardItems],
  );

  return { contentFit, geometryMenuItems };
}
