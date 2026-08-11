import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTouchRowHeight } from "../../../navigation/useTouchRowHeight";
import { classNames } from "../../shared/classNames";
import {
  MiniAppTableEmptyRow,
  type MiniAppTableEmptyRowProps,
} from "../tables/MiniAppTable";
import "./MiniAppVirtual.css";

const MINI_APP_VIRTUAL_DEFAULT_OVERSCAN_ROWS = 8;
export const MINI_APP_VIRTUAL_DEFAULT_MIN_WINDOW_ROWS = 24;
export const MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT = 36;
export const MINI_APP_VIRTUAL_SIDEBAR_ROW_HEIGHT = 28;
export const MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT = 48;

interface MiniAppVirtualStyle extends CSSProperties {
  "--mini-app-virtual-row-height"?: string;
}

export function getMiniAppVirtualFrameStyle(
  rowHeight: number,
  style?: CSSProperties | undefined,
): MiniAppVirtualStyle {
  return {
    ...style,
    "--mini-app-virtual-row-height": `${rowHeight}px`,
  };
}

export function getMiniAppVirtualWindowRange(params: {
  minWindowRows?: number | undefined;
  overscanRows?: number | undefined;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}): { limit: number; offset: number } {
  const rowHeight = Number.isFinite(params.rowHeight)
    ? Math.max(1, params.rowHeight)
    : 1;
  const overscanRows = Math.max(
    0,
    params.overscanRows ?? MINI_APP_VIRTUAL_DEFAULT_OVERSCAN_ROWS,
  );
  const minWindowRows = Math.max(
    1,
    params.minWindowRows ?? MINI_APP_VIRTUAL_DEFAULT_MIN_WINDOW_ROWS,
  );
  const scrollTop = Number.isFinite(params.scrollTop)
    ? Math.max(0, params.scrollTop)
    : 0;
  const viewportHeight = Number.isFinite(params.viewportHeight)
    ? Math.max(0, params.viewportHeight)
    : 0;
  const visibleRows = Math.ceil(viewportHeight / rowHeight);
  const offset = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const limit = Math.max(minWindowRows, visibleRows + overscanRows * 2);

  return { limit, offset };
}

/**
 * A frame element and its observed box.
 *
 * Split out of the virtual viewport below so a table that folds on its frame's
 * width *without* virtualizing — a detail-panel section list, whose frame grows
 * with the panel instead of windowing its own rows — measures the frame through
 * the same observer and the same "0 means not measured yet" convention, rather
 * than growing a second pair that could disagree.
 */
export function useMiniAppFrameBox<
  TFrame extends HTMLElement = HTMLDivElement,
>(): {
  frame: TFrame | null;
  frameRef: (nextFrame: TFrame | null) => void;
  frameWidth: number;
  viewportHeight: number;
} {
  const [frame, setFrame] = useState<TFrame | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  // 0 means "not measured yet" — the frame is unmounted, or the observer has
  // not run. Consumers deciding a layout from the width must treat 0 as
  // unknown rather than as narrow.
  const [frameWidth, setFrameWidth] = useState(0);
  const frameRef = useCallback((nextFrame: TFrame | null) => {
    setFrame(nextFrame);
  }, []);

  useEffect(() => {
    if (!frame) {
      setViewportHeight(0);
      setFrameWidth(0);
      return;
    }

    setViewportHeight(frame.clientHeight);
    setFrameWidth(frame.clientWidth);
    const resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (entry) {
        setViewportHeight(entry.target.clientHeight);
        setFrameWidth(entry.target.clientWidth);
      }
    });
    resizeObserver.observe(frame);

    return () => {
      resizeObserver.disconnect();
    };
  }, [frame]);

  return { frame, frameRef, frameWidth, viewportHeight };
}

function useMiniAppVirtualViewport<TFrame extends HTMLElement>() {
  const { frame, frameRef, frameWidth, viewportHeight } =
    useMiniAppFrameBox<TFrame>();
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (!frame) {
      setScrollTop(0);
      return;
    }

    const handleScroll = () => {
      setScrollTop(frame.scrollTop);
    };

    handleScroll();
    frame.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      frame.removeEventListener("scroll", handleScroll);
    };
  }, [frame]);

  return {
    frame,
    frameRef,
    frameWidth,
    scrollTop,
    setScrollTop,
    viewportHeight,
  };
}

export function useMiniAppVirtualWindow<
  TFrame extends HTMLElement = HTMLDivElement,
>(params: {
  minWindowRows?: number | undefined;
  overscanRows?: number | undefined;
  resetKey?: unknown;
  rowHeight: number;
}): {
  frame: TFrame | null;
  frameRef: (nextFrame: TFrame | null) => void;
  frameWidth: number;
  limit: number;
  offset: number;
  scrollTop: number;
  viewportHeight: number;
} {
  const { minWindowRows, overscanRows, resetKey } = params;
  // In the routed (touch) layout every virtualized row grows to the 44px HIG
  // target. Bumping the pitch here — the single place the window math reads it —
  // keeps the rendered row height (driven off the same value) in lockstep.
  const rowHeight = useTouchRowHeight(params.rowHeight);
  const {
    frame,
    frameRef,
    frameWidth,
    scrollTop,
    setScrollTop,
    viewportHeight,
  } = useMiniAppVirtualViewport<TFrame>();
  const [activeResetKey, setActiveResetKey] = useState(resetKey);
  const shouldReset = activeResetKey !== resetKey;
  const previousRowHeightRef = useRef(rowHeight);

  useEffect(() => {
    if (!shouldReset) {
      return;
    }

    setActiveResetKey(resetKey);
    setScrollTop(0);
    if (frame) {
      frame.scrollTop = 0;
    }
  }, [frame, resetKey, setScrollTop, shouldReset]);

  // `scrollTop` is pixels but the window range is rows, so a pitch change with
  // the pixel offset left alone silently scrolls the list: the same pixel
  // resolves to a different row. Rescale by the ratio, which keeps the row at
  // the top of the viewport exactly where it was — and, because the derived
  // offset is then unchanged, avoids both a refetch and the blank frame the
  // detail pane would otherwise show while it lands.
  //
  // Derived during render rather than in an effect: an effect runs after the
  // render that already computed a range from the old pixel offset at the new
  // pitch, and a consumer that fetches from that range (the explorer item
  // window) would issue a query for the transient offset and blank its list
  // before the correction arrived.
  const previousRowHeight = previousRowHeightRef.current;
  const rescaledScrollTop =
    previousRowHeight === rowHeight || scrollTop <= 0
      ? scrollTop
      : Math.round((scrollTop * rowHeight) / previousRowHeight);

  useLayoutEffect(() => {
    previousRowHeightRef.current = rowHeight;
    if (rescaledScrollTop === scrollTop) {
      return;
    }

    if (!frame) {
      setScrollTop(rescaledScrollTop);
      return;
    }

    // Read back rather than storing what was asked for. Unfolding near the end
    // of a list scales the offset down but not the viewport, so the request can
    // exceed the shorter content's maximum and the browser clamps it. Storing
    // the unclamped value would leave the state describing a window the frame
    // is not showing until the queued scroll event corrected it.
    frame.scrollTop = rescaledScrollTop;
    setScrollTop(frame.scrollTop);
  }, [frame, rescaledScrollTop, rowHeight, scrollTop, setScrollTop]);

  const range = getMiniAppVirtualWindowRange({
    minWindowRows,
    overscanRows,
    rowHeight,
    scrollTop: shouldReset ? 0 : rescaledScrollTop,
    viewportHeight,
  });

  return {
    frame,
    frameRef,
    frameWidth,
    limit: range.limit,
    offset: range.offset,
    scrollTop: shouldReset ? 0 : rescaledScrollTop,
    viewportHeight,
  };
}

export function useMiniAppVirtualRows<TItem>(params: {
  minWindowRows?: number | undefined;
  overscanRows?: number | undefined;
  resetKey?: unknown;
  rowHeight: number;
  rows: ReadonlyArray<TItem>;
}): {
  bottomPadding: number;
  frame: HTMLDivElement | null;
  frameRef: (nextFrame: HTMLDivElement | null) => void;
  frameWidth: number;
  limit: number;
  offset: number;
  rows: ReadonlyArray<TItem>;
  topPadding: number;
  totalCount: number;
} {
  const { rows } = params;
  // Touch pitch (see useMiniAppVirtualWindow). Bump here too so the top/bottom
  // spacer padding below matches the window offsets computed from the same
  // height; useTouchRowHeight is idempotent, so the nested window call agrees.
  const rowHeight = useTouchRowHeight(params.rowHeight);
  const virtualWindow = useMiniAppVirtualWindow<HTMLDivElement>({
    minWindowRows: params.minWindowRows,
    overscanRows: params.overscanRows,
    resetKey: params.resetKey,
    rowHeight,
  });
  const offset = Math.min(
    virtualWindow.offset,
    Math.max(0, rows.length - virtualWindow.limit),
  );
  const visibleRows = useMemo(
    () => rows.slice(offset, offset + virtualWindow.limit),
    [offset, rows, virtualWindow.limit],
  );

  return {
    bottomPadding:
      Math.max(0, rows.length - offset - visibleRows.length) * rowHeight,
    frame: virtualWindow.frame,
    frameRef: virtualWindow.frameRef,
    frameWidth: virtualWindow.frameWidth,
    limit: virtualWindow.limit,
    offset,
    rows: visibleRows,
    topPadding: offset * rowHeight,
    totalCount: rows.length,
  };
}

export const MiniAppVirtualListFrame = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & {
    rowHeight: number;
  }
>(function MiniAppVirtualListFrame(
  { className, rowHeight, style, ...props },
  ref,
) {
  // Match the touch pitch the window hook uses so the CSS row height (driven by
  // this frame's --mini-app-virtual-row-height var) stays consistent.
  const touchRowHeight = useTouchRowHeight(rowHeight);
  return (
    <div
      {...props}
      className={classNames("mini-app-virtual-list-frame", className)}
      ref={ref}
      style={getMiniAppVirtualFrameStyle(touchRowHeight, style)}
    />
  );
});

export function MiniAppVirtualList({
  bottomPadding,
  children,
  className,
  topPadding,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  bottomPadding: number;
  topPadding: number;
}) {
  return (
    <div {...props} className={classNames("mini-app-virtual-list", className)}>
      <MiniAppVirtualBlockSpacer height={topPadding} />
      {children}
      <MiniAppVirtualBlockSpacer height={bottomPadding} />
    </div>
  );
}

export function MiniAppVirtualListRow({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={classNames("mini-app-virtual-list-row", className)}
    />
  );
}

export function MiniAppVirtualBlockSpacer({ height }: { height: number }) {
  if (height <= 0) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="mini-app-virtual-block-spacer"
      style={{ height }}
    />
  );
}

export function MiniAppVirtualTableSpacerRow({
  className,
  height,
  ...props
}: Omit<MiniAppTableEmptyRowProps, "children"> & {
  height: number;
}) {
  if (height <= 0) {
    return null;
  }

  return (
    <MiniAppTableEmptyRow
      {...props}
      aria-hidden="true"
      className={classNames("mini-app-virtual-table-spacer-row", className)}
      style={{ ...props.style, height }}
    >
      {""}
    </MiniAppTableEmptyRow>
  );
}
