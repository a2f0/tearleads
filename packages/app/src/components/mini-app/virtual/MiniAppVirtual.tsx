import {
  type CSSProperties,
  forwardRef,
  type HTMLAttributes,
  useCallback,
  useEffect,
  useMemo,
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
export const MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT = 48;
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

function useMiniAppVirtualViewport<TFrame extends HTMLElement>() {
  const [frame, setFrame] = useState<TFrame | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const frameRef = useCallback((nextFrame: TFrame | null) => {
    setFrame(nextFrame);
  }, []);

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

  useEffect(() => {
    if (!frame) {
      setViewportHeight(0);
      return;
    }

    setViewportHeight(frame.clientHeight);
    if (typeof ResizeObserver !== "function") {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (entry) {
        setViewportHeight(entry.target.clientHeight);
      }
    });
    resizeObserver.observe(frame);

    return () => {
      resizeObserver.disconnect();
    };
  }, [frame]);

  return { frame, frameRef, scrollTop, setScrollTop, viewportHeight };
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
  const { frame, frameRef, scrollTop, setScrollTop, viewportHeight } =
    useMiniAppVirtualViewport<TFrame>();
  const [activeResetKey, setActiveResetKey] = useState(resetKey);
  const shouldReset = activeResetKey !== resetKey;

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

  const range = getMiniAppVirtualWindowRange({
    minWindowRows,
    overscanRows,
    rowHeight,
    scrollTop: shouldReset ? 0 : scrollTop,
    viewportHeight,
  });

  return {
    frame,
    frameRef,
    limit: range.limit,
    offset: range.offset,
    scrollTop: shouldReset ? 0 : scrollTop,
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
