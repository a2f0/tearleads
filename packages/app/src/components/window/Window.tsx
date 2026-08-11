import {
  type CSSProperties,
  type HTMLAttributes,
  type PropsWithChildren,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./Window.css";
import { CurrentWindowProvider } from "./CurrentWindowContext";
import {
  useWindowGeometry,
  type WindowPosition,
  type WindowSize,
} from "./useWindowGeometry";
import { WindowBody } from "./WindowBody";
import { WindowMenuBar, type WindowMenuItem } from "./WindowMenuBar";
import {
  useWindowFileMenuItems,
  useWindowViewMenuItems,
  WindowMenuProvider,
} from "./WindowMenuContext";
import { WindowMiniAppRouteBoundary } from "./WindowMiniAppRouteBoundary";
import type { ResizeCorner } from "./WindowResizeHandle";
import { WindowResizeHandle } from "./WindowResizeHandle";
import {
  hasWindowSidebar,
  useWindowSidebar,
  WindowSidebarProvider,
} from "./WindowSidebarContext";
import {
  useWindowActions as useWindowStateActions,
  useWindowStateData,
  type WindowEntry,
} from "./WindowStateProvider";
import { WindowStatusBar } from "./WindowStatusBar";
import { WindowTitleBar } from "./WindowTitleBar";
import { WindowToolBar } from "./WindowToolBar";

interface WindowProps {
  windowId: string;
}

const WINDOW_STATUS_MESSAGE_DURATION_MS = 2500;

export function Window({ windowId }: WindowProps) {
  const { windowMap } = useWindowStateData();
  const entry = windowMap.get(windowId);

  if (!entry) return null;

  return <WindowInner entry={entry} />;
}

function useWindowActions(
  entry: WindowEntry,
  fileMenuItems: WindowMenuItem[],
  viewMenuItems: WindowMenuItem[],
  hasSidebar: boolean,
) {
  const { close, minimize, moveBackward, moveForward, toggleMaximize } =
    useWindowStateActions();
  const [showStatusBar, setShowStatusBar] = useState(true);
  const [showSidebar, setShowSidebar] = useState(
    entry.initialShowSidebar ?? true,
  );
  const handleClose = useCallback(() => close(entry.id), [close, entry.id]);
  const handleMinimize = useCallback(
    () => minimize(entry.id),
    [entry.id, minimize],
  );
  const handleMoveForward = useCallback(
    () => moveForward(entry.id),
    [entry.id, moveForward],
  );
  const handleMoveBackward = useCallback(
    () => moveBackward(entry.id),
    [entry.id, moveBackward],
  );
  const handleMaximize = useCallback(
    () => toggleMaximize(entry.id),
    [entry.id, toggleMaximize],
  );
  const toggleStatusBar = useCallback(
    () => setShowStatusBar((previous) => !previous),
    [],
  );
  const toggleSidebar = useCallback(
    () => setShowSidebar((previous) => !previous),
    [],
  );
  const menus = useMemo(
    () => [
      {
        label: "File",
        items: [
          ...fileMenuItems,
          { id: "close", label: "Close", onClick: handleClose },
        ],
      },
      {
        label: "View",
        items: [
          ...viewMenuItems,
          {
            id: "toggle-status-bar",
            label: `${showStatusBar ? "Hide" : "Show"} Status Bar`,
            onClick: toggleStatusBar,
          },
          ...(hasSidebar
            ? [
                {
                  id: "toggle-sidebar",
                  label: `${showSidebar ? "Hide" : "Show"} Sidebar`,
                  onClick: toggleSidebar,
                },
              ]
            : []),
        ],
      },
    ],
    [
      hasSidebar,
      handleClose,
      fileMenuItems,
      showSidebar,
      showStatusBar,
      toggleSidebar,
      toggleStatusBar,
      viewMenuItems,
    ],
  );

  return {
    handleClose,
    handleMaximize,
    handleMinimize,
    handleMoveBackward,
    handleMoveForward,
    menus,
    showSidebar,
    showStatusBar,
  };
}

function getWindowStyle(
  maximized: boolean,
  position: WindowPosition | null,
  size: WindowSize | null,
  zIndex: number,
): CSSProperties | undefined {
  if (maximized) {
    return { top: 0, left: 0, width: "100%", height: "100%", zIndex };
  }
  if (!position) {
    return { visibility: "hidden", zIndex };
  }

  return {
    left: position.x,
    top: position.y,
    zIndex,
    ...(size ? { width: size.width, height: size.height } : {}),
  };
}

function useWindowStatusMessage() {
  const [statusText, setStatusText] = useState("");
  const statusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showStatusMessage = useCallback((message: string) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusText(message);
    statusTimeoutRef.current = setTimeout(() => {
      setStatusText("");
      statusTimeoutRef.current = null;
    }, WINDOW_STATUS_MESSAGE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  return { showStatusMessage, statusText };
}

// Refcounted so overlapping overlays (one closing as another opens) never leave
// the row hidden, and never flash it back for a frame between the two.
function useWindowToolbarSuppression() {
  const [suppressionCount, setSuppressionCount] = useState(0);
  const suppressToolbar = useCallback(() => {
    setSuppressionCount((count) => count + 1);
    return () => setSuppressionCount((count) => Math.max(0, count - 1));
  }, []);

  return { suppressToolbar, toolbarSuppressed: suppressionCount > 0 };
}

function WindowResizeHandles({
  handleResizeMouseDown,
}: {
  handleResizeMouseDown: (event: ReactMouseEvent, corner: ResizeCorner) => void;
}) {
  return (
    <>
      <WindowResizeHandle corner="se" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="sw" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="ne" onMouseDown={handleResizeMouseDown} />
      <WindowResizeHandle corner="nw" onMouseDown={handleResizeMouseDown} />
    </>
  );
}

function WindowInner({ entry }: { entry: WindowEntry }) {
  return (
    <WindowMenuProvider>
      <WindowSidebarProvider>
        <WindowInnerContent entry={entry} />
      </WindowSidebarProvider>
    </WindowMenuProvider>
  );
}

// The bars above the body: title, menus, and the toolbar row a full-pane overlay
// can stand down (see `useWindowToolbarSuppression`).
function WindowChrome({
  actions,
  entry,
  onGoBack,
  onMouseDown,
  toolbarSuppressed,
}: {
  actions: ReturnType<typeof useWindowActions>;
  entry: WindowEntry;
  onGoBack: () => void;
  onMouseDown: (event: ReactMouseEvent) => void;
  toolbarSuppressed: boolean;
}) {
  return (
    <>
      <WindowTitleBar
        title={entry.title}
        onMouseDown={onMouseDown}
        onMinimize={actions.handleMinimize}
        onMaximize={actions.handleMaximize}
        onClose={actions.handleClose}
        onMoveForward={actions.handleMoveForward}
        onMoveBackward={actions.handleMoveBackward}
      />
      <WindowMenuBar menus={actions.menus} />
      {!toolbarSuppressed && (
        <WindowToolBar
          canGoBack={(entry.miniAppRouteHistory?.length ?? 0) > 0}
          showHistoryBack={entry.appId !== undefined}
          onGoBack={onGoBack}
        />
      )}
    </>
  );
}

function WindowInnerContent({ entry }: { entry: WindowEntry }) {
  const { maximized, minimized, zIndex, component: Component } = entry;
  const windowRef = useRef<HTMLDivElement>(null);
  const [overlayHost, setOverlayHost] = useState<HTMLElement | null>(null);
  const fileMenuItems = useWindowFileMenuItems();
  const viewMenuItems = useWindowViewMenuItems();
  const { sidebar } = useWindowSidebar();
  const hasSidebar = hasWindowSidebar(sidebar);
  const actions = useWindowActions(
    entry,
    fileMenuItems,
    viewMenuItems,
    hasSidebar,
  );
  const { handleMouseDown, handleResizeMouseDown, position, size } =
    useWindowGeometry(entry, maximized, windowRef);
  const { showStatusMessage, statusText } = useWindowStatusMessage();
  const { suppressToolbar, toolbarSuppressed } = useWindowToolbarSuppression();
  // The toolbar renders above the route boundary, so the window's own Back stack
  // is threaded in from here rather than read from context.
  const { bringToFront, goBackMiniAppRoute } = useWindowStateActions();
  const handleGoBack = useCallback(() => {
    goBackMiniAppRoute(entry.id);
  }, [entry.id, goBackMiniAppRoute]);
  const handleWindowMouseDown = useCallback(() => {
    bringToFront(entry.id);
  }, [bringToFront, entry.id]);
  const handleWindowContextMenu = useCallback((event: ReactMouseEvent) => {
    // Keep background pane context menus from opening underneath window-local menus.
    event.stopPropagation();
  }, []);
  const windowContextMenuTrapProps: Pick<
    HTMLAttributes<HTMLDivElement>,
    "onContextMenu"
  > = {
    onContextMenu: handleWindowContextMenu,
  };
  const style = getWindowStyle(maximized, position, size, zIndex);

  if (minimized) {
    return null;
  }

  return (
    <div
      ref={windowRef}
      className={maximized ? "window window--maximized" : "window"}
      {...windowContextMenuTrapProps}
      onMouseDownCapture={handleWindowMouseDown}
      style={style}
    >
      <WindowChrome
        actions={actions}
        entry={entry}
        onGoBack={handleGoBack}
        onMouseDown={handleMouseDown}
        toolbarSuppressed={toolbarSuppressed}
      />
      <CurrentWindowProvider
        close={actions.handleClose}
        id={entry.id}
        overlayHost={overlayHost}
        showStatusMessage={showStatusMessage}
        suppressToolbar={suppressToolbar}
      >
        <WindowBodyWithSidebar
          overlayHostRef={setOverlayHost}
          showSidebar={actions.showSidebar}
        >
          <WindowMiniAppRouteBoundary entry={entry}>
            {Component && <Component />}
          </WindowMiniAppRouteBoundary>
        </WindowBodyWithSidebar>
      </CurrentWindowProvider>
      {actions.showStatusBar && <WindowStatusBar text={statusText} />}
      {!maximized && (
        <WindowResizeHandles handleResizeMouseDown={handleResizeMouseDown} />
      )}
    </div>
  );
}

function WindowBodyWithSidebar({
  showSidebar,
  overlayHostRef,
  children,
}: PropsWithChildren<{
  overlayHostRef: (element: HTMLDivElement | null) => void;
  showSidebar: boolean;
}>) {
  const { sidebar } = useWindowSidebar();
  const hasSidebar = hasWindowSidebar(sidebar);

  return (
    <WindowBody
      contentRef={overlayHostRef}
      showSidebar={showSidebar && hasSidebar}
      sidebar={sidebar}
    >
      {children}
    </WindowBody>
  );
}
